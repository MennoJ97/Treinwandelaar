/**
 * Ingest Wandelnet's station-to-station walks: the current NS-wandelingen and the retired ones
 * that live on as "OV-stappers". Overview → route pages → reviews → GPX → `walks`.
 * Run `stations` first. Raw responses are cached in data/raw (use --refresh to re-download).
 * Personal use only: Wandelnet's terms forbid republishing this data.
 */
import { readFileSync, existsSync } from 'node:fs';
import { openDb } from '../../src/lib/server/db';
import { haversine, lineLengthKm, nearest, type LngLat } from '../../src/lib/geo';
import type { Collection, Station } from '../../src/lib/types';
import { fetchCached } from '../lib/http';
import { pruneStale, saveWalk } from '../lib/store';
import { WANDELNET, parseGpx, parseList, parseReviews, parseRoutePage } from '../lib/wandelnet';

const COLLECTIONS: { path: string; collection: Collection }[] = [
	{ path: '/ns-wandelingen', collection: 'ns-wandeling' },
	{ path: '/ov-stappers', collection: 'ov-stapper' }
];

const MAX_STATION_DISTANCE_M = 1500;
/** Some walks end in a village without a station (e.g. Wageningen); fall back to the nearest one. */
const FALLBACK_STATION_DISTANCE_M = 12_000;
const OVERRIDES_FILE = 'scripts/ingest/overrides.json';

type Overrides = Record<string, { startStation?: string; endStation?: string; skip?: boolean }>;
type Match = { code: string; metres: number | null; how: string };

function matchStation(
	point: LngLat | undefined,
	place: string | null,
	stations: Station[]
): Match | null {
	if (point) {
		const hit = nearest(point, stations, MAX_STATION_DISTANCE_M);
		if (hit)
			return {
				code: hit.item.code,
				metres: Math.round(hit.metres),
				how: `${Math.round(hit.metres)} m`
			};
	}
	// The published place name ("Culemborg" → station "Culemborg").
	const byName = place && stations.find((s) => s.name.toLowerCase() === place.toLowerCase());
	if (byName) return { code: byName.code, metres: null, how: 'name' };
	if (point) {
		const far = nearest(point, stations, FALLBACK_STATION_DISTANCE_M);
		if (far)
			return {
				code: far.item.code,
				metres: Math.round(far.metres),
				how: `${(far.metres / 1000).toFixed(1)} km, bus`
			};
	}
	return null;
}

function fromOverride(code: string, point: LngLat | undefined, stations: Station[]): Match {
	const station = stations.find((s) => s.code === code);
	if (!station) throw new Error(`override station ${code} not found`);
	const metres = point ? Math.round(haversine(point, [station.lng, station.lat])) : null;
	return { code, metres, how: `override, ${metres ?? '?'} m` };
}

async function main() {
	const db = openDb();
	const stations = db.prepare('select * from stations').all() as unknown as Station[];
	if (!stations.length) throw new Error('No stations; run `npm run ingest:stations` first.');
	const overrides: Overrides = existsSync(OVERRIDES_FILE)
		? JSON.parse(readFileSync(OVERRIDES_FILE, 'utf8'))
		: {};

	const problems: string[] = [];
	const seen = new Set<string>();
	const stored: { name: string; start?: string; end?: string; km: number }[] = [];
	for (const { path, collection } of COLLECTIONS) {
		const list = parseList(await fetchCached(`${WANDELNET}${path}`));
		console.log(`\n${path} lists ${list.length} walks.`);
		let count = 0;

		for (const entry of list) {
			const id = `wandelnet:${entry.id}`;
			// A walk listed in both overviews counts as the current NS walk.
			if (seen.has(id)) continue;
			const override = overrides[id] ?? {};
			if (override.skip) continue;
			try {
				const url = `${WANDELNET}/wandelroute/${entry.id}/`;
				const page = parseRoutePage(await fetchCached(url));
				if (!page.gpxUrl) throw new Error('no GPX link');
				const track = parseGpx(await fetchCached(page.gpxUrl));
				if (track.length < 2) throw new Error('empty GPX');
				const reviews =
					page.reviewCount && page.reviewUrl
						? parseReviews(await fetchCached(page.reviewUrl))
						: { count: 0, average: null };

				const startPlace = page.startPlace ?? entry.startPlace;
				const endPlace = page.endPlace ?? entry.endPlace;
				const start = override.startStation
					? fromOverride(override.startStation, track[0], stations)
					: matchStation(track[0], startPlace, stations);
				const end = override.endStation
					? fromOverride(override.endStation, track.at(-1), stations)
					: matchStation(track.at(-1), endPlace, stations);

				const distanceKm = Math.round(lineLengthKm(track) * 10) / 10;
				const stated = page.statedKm ?? entry.statedKm;
				const name = page.name || entry.name;
				if (!start || !end)
					problems.push(
						`${id} ${name}: unmatched ${!start ? 'start' : ''} ${!end ? 'end' : ''} (${startPlace} → ${endPlace})`
					);
				for (const [label, m] of [
					['start', start],
					['end', end]
				] as const)
					if (m?.metres && m.metres > MAX_STATION_DISTANCE_M)
						problems.push(`${id} ${name}: ${label} is ${m.how} from ${m.code}`);
				if (stated && Math.abs(distanceKm - stated) / stated > 0.15)
					problems.push(`${id} ${name}: GPX ${distanceKm} km vs stated ${stated} km`);

				// Some retired walks are listed twice under different ids (e.g. "Linge").
				const twin = stored.find(
					(w) =>
						w.start === start?.code &&
						w.end === end?.code &&
						Math.abs(w.km - distanceKm) / distanceKm < 0.1
				);
				if (twin) {
					console.log(`= ${name.padEnd(36)} same route as "${twin.name}", skipped`);
					continue;
				}

				saveWalk(db, {
					id,
					sourceId: entry.id,
					collection,
					name,
					startPlace,
					endPlace,
					startStation: start?.code ?? null,
					endStation: end?.code ?? null,
					startStationM: start?.metres ?? null,
					endStationM: end?.metres ?? null,
					// A loop if the route itself returns to its start, not merely shares a station with it
					// (bus-leg walks can start and end at the same station without being a loop).
					isLoop: haversine(track[0], track.at(-1)!) < MAX_STATION_DISTANCE_M,
					distanceKm,
					statedDistanceKm: stated,
					description: page.description,
					accessibility: page.accessibility,
					features: page.features,
					track,
					ratingAvg: reviews.average,
					reviewCount: reviews.count || page.reviewCount,
					sourceUrl: url,
					gpxUrl: page.gpxUrl,
					photos: [page.headerImage, entry.image]
						.filter((u): u is string => !!u)
						.map((u) => ({ url: u, caption: null }))
				});
				seen.add(id);
				stored.push({ name, start: start?.code, end: end?.code, km: distanceKm });
				count++;
				console.log(
					`✓ ${name.padEnd(36)} ${String(distanceKm).padStart(5)} km  ${start?.code ?? '??'} (${start?.how ?? '-'}) → ${end?.code ?? '??'} (${end?.how ?? '-'})  ★${reviews.average ?? '-'} (${reviews.count})`
				);
			} catch (err) {
				problems.push(`${id} ${entry.name}: ${(err as Error).message}`);
			}
		}
		console.log(`Stored ${count}/${list.length} from ${path}.`);
	}

	const pruned = pruneStale(
		db,
		COLLECTIONS.map((c) => c.collection),
		seen
	);
	if (pruned) console.log(`Removed ${pruned} walk(s) no longer listed.`);
	if (problems.length) {
		console.log(`\n${problems.length} issue(s) — fix via ${OVERRIDES_FILE} if needed:`);
		for (const p of problems) console.log(`  - ${p}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
