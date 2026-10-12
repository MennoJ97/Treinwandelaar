/**
 * Ingest Wandelnet NS-wandelingen: overview → route pages → reviews → GPX → `walks`.
 * Run `stations` first. Raw responses are cached in data/raw (use --refresh to re-download).
 * Personal use only: Wandelnet's terms forbid republishing this data.
 */
import { readFileSync, existsSync } from 'node:fs';
import { openDb, transaction } from '../../src/lib/server/db';
import { haversine, lineLengthKm, nearest, simplify, type LngLat } from '../../src/lib/geo';
import type { Station } from '../../src/lib/types';
import { fetchCached } from '../lib/http';
import { WANDELNET, parseGpx, parseList, parseReviews, parseRoutePage } from '../lib/wandelnet';

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

	const list = parseList(await fetchCached(`${WANDELNET}/ns-wandelingen`));
	console.log(`Overview lists ${list.length} NS walks.`);

	const upsertWalk = db.prepare(`
		insert into walks (id, source, source_id, name, start_place, end_place, start_station, end_station,
			start_station_m, end_station_m, is_loop, distance_km, stated_distance_km, description, accessibility, features, geometry,
			rating_avg, review_count, source_url, gpx_url, updated_at)
		values (?, 'wandelnet', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
		on conflict(id) do update set name = excluded.name, start_place = excluded.start_place,
			end_place = excluded.end_place, start_station = excluded.start_station,
			end_station = excluded.end_station, start_station_m = excluded.start_station_m,
			end_station_m = excluded.end_station_m, is_loop = excluded.is_loop, distance_km = excluded.distance_km,
			stated_distance_km = excluded.stated_distance_km, description = excluded.description,
			accessibility = excluded.accessibility, features = excluded.features, geometry = excluded.geometry,
			rating_avg = excluded.rating_avg, review_count = excluded.review_count,
			source_url = excluded.source_url, gpx_url = excluded.gpx_url, updated_at = excluded.updated_at`);
	const deletePhotos = db.prepare(
		`delete from walk_photos where walk_id = ? and source = 'wandelnet'`
	);
	const insertPhoto = db.prepare(
		`insert or ignore into walk_photos (walk_id, url, caption, source, sort) values (?, ?, ?, 'wandelnet', ?)`
	);

	const problems: string[] = [];
	let stored = 0;
	for (const entry of list) {
		const id = `wandelnet:${entry.id}`;
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
			if (!start || !end)
				problems.push(
					`${id} ${page.name}: unmatched ${!start ? 'start' : ''} ${!end ? 'end' : ''} (${startPlace} → ${endPlace})`
				);
			for (const [label, m] of [
				['start', start],
				['end', end]
			] as const)
				if (m?.metres && m.metres > MAX_STATION_DISTANCE_M)
					problems.push(`${id} ${page.name}: ${label} is ${m.how} from ${m.code}`);
			if (stated && Math.abs(distanceKm - stated) / stated > 0.15)
				problems.push(`${id} ${page.name}: GPX ${distanceKm} km vs stated ${stated} km`);

			const geometry = simplify(track, 8).map(([lng, lat]) => [
				Math.round(lng * 1e5) / 1e5,
				Math.round(lat * 1e5) / 1e5
			]);
			transaction(db, () => {
				upsertWalk.run(
					id,
					entry.id,
					page.name || entry.name,
					startPlace,
					endPlace,
					start?.code ?? null,
					end?.code ?? null,
					start?.metres ?? null,
					end?.metres ?? null,
					start && end && start.code === end.code ? 1 : 0,
					distanceKm,
					stated,
					page.description,
					page.accessibility,
					JSON.stringify(page.features),
					JSON.stringify(geometry),
					reviews.average,
					reviews.count || page.reviewCount,
					url,
					page.gpxUrl
				);
				deletePhotos.run(id);
				[page.headerImage, entry.image]
					.filter((u): u is string => !!u)
					.forEach((u, i) => insertPhoto.run(id, u, null, i));
			});
			stored++;
			console.log(
				`✓ ${page.name.padEnd(36)} ${String(distanceKm).padStart(5)} km  ${start?.code ?? '??'} (${start?.how ?? '-'}) → ${end?.code ?? '??'} (${end?.how ?? '-'})  ★${reviews.average ?? '-'} (${reviews.count})`
			);
		} catch (err) {
			problems.push(`${id} ${entry.name}: ${(err as Error).message}`);
		}
	}

	console.log(`\nStored ${stored}/${list.length} walks.`);
	if (problems.length) {
		console.log(`\n${problems.length} issue(s) — fix via ${OVERRIDES_FILE} if needed:`);
		for (const p of problems) console.log(`  - ${p}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
