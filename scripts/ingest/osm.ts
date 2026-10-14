/**
 * Ingest walking routes from OpenStreetMap as station-to-station (or station-round) day walks: the
 * walks of the public demo, and for signed-in users every one that Wandelnet's data doesn't already
 * cover (see routeIndex). ODbL, © OpenStreetMap contributors.
 *
 * - LAW routes (network=nwn) and streekpaden (rwn) are mapped stage by stage; like ../ingest/paden.ts we
 *   join the stages and cut the line into sections between stations.
 * - Local walks (lwn): round walks that pass a station start there; others are cut like a path.
 * - NS-wandelingen are skipped (see isNsWalk), and so are knooppunt links and side branches.
 *
 * The Netherlands is queried in tiles, for routes near stations only, so each Overpass response stays
 * small; responses are cached like every other download (pass --refresh to re-fetch). With --partial,
 * only tiles already in the cache are used and nothing is pruned: for filling a database while the
 * rest still downloads.
 */
import { openDb } from '../../src/lib/server/db';
import { lineLengthKm, type LngLat } from '../../src/lib/geo';
import type { Collection, Station } from '../../src/lib/types';
import { oldestFetch } from '../lib/http';
import {
	classify,
	isClosed,
	rotateLoop,
	stageOf,
	stitch,
	DUPLICATE_SHARE,
	routeIndex,
	type OsmRelation
} from '../lib/osm';
import { cachedOverpass, queryOverpass } from '../lib/overpass';
import {
	chainStages,
	DEFAULT_SECTION,
	pickSections,
	sectionKm,
	stationHits,
	type SectionOptions
} from '../lib/sections';
import { pruneStale, recordFetched, saveWalk, type WalkRecord } from '../lib/store';

/** How far a station may be from the route: this bit is walked extra, to/from the platform. */
const STATION_RANGE_M = 1500;
/** Local walks are shorter than a stretch of LAW. */
const LOCAL_SECTION: SectionOptions = { minKm: 5, targetKm: 12, maxKm: 26 };
const LOOP_KM = { min: 4, max: 30 };

const [SOUTH, WEST, NORTH, EAST] = [50.75, 3.35, 53.55, 7.25];
const TILE = { lat: 0.5, lng: 0.65 };
const PARTIAL = process.argv.includes('--partial');

/**
 * Routes passing within STATION_RANGE_M of an NS station (stations carry their NS code in
 * `railway:ref`) in this tile. A route near stations in two tiles comes twice; we keep one.
 */
const tileQuery = (s: number, w: number, n: number, e: number) => `
[out:json][timeout:180];
area["ISO3166-1"="NL"][admin_level=2]->.nl;
nwr(area.nl)["railway"="station"]["railway:ref"](${s},${w},${n},${e})->.stations;
rel(around.stations:${STATION_RANGE_M})[type=route][route~"^(hiking|foot)$"][network~"^(lwn|rwn|nwn)$"][name];
out geom;`;

const relationUrl = (id: number) => `https://www.openstreetmap.org/relation/${id}`;
const slug = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
const twoDigits = (n: number) => String(n).padStart(2, '0');

/** "Route van Utrechts Landschap." plus OSM's own description, if any. */
function about(tags: Record<string, string>): string | null {
	const parts = [tags.description, tags.operator && `Route van ${tags.operator}.`];
	return parts.filter(Boolean).join(' ') || null;
}

async function loadRelations(): Promise<{ relations: OsmRelation[]; missing: number }> {
	const relations = new Map<number, OsmRelation>();
	let missing = 0;
	for (let s = SOUTH; s < NORTH; s += TILE.lat)
		for (let w = WEST; w < EAST; w += TILE.lng) {
			const query = tileQuery(s, w, s + TILE.lat, w + TILE.lng);
			const text = PARTIAL ? cachedOverpass(query) : await queryOverpass(query);
			if (text === null) {
				missing++;
				process.stdout.write('_');
				continue;
			}
			const { elements } = JSON.parse(text) as { elements: OsmRelation[] };
			for (const el of elements) if (el.type === 'relation') relations.set(el.id, el);
			process.stdout.write('.');
		}
	process.stdout.write('\n');
	return { relations: [...relations.values()], missing };
}

/** The longest stitched line: stages are drawn as one line plus the odd stray bit. */
const longest = (lines: LngLat[][]) =>
	lines.reduce<LngLat[] | null>((a, b) => (!a || lineLengthKm(b) > lineLengthKm(a) ? b : a), null);

async function main() {
	const db = openDb();
	const stations = db.prepare('select * from stations').all() as unknown as Station[];
	if (!stations.length) throw new Error('No stations; run `npm run ingest:stations` first.');
	const stationName = (code: string) => stations.find((s) => s.code === code)?.name ?? code;

	const { relations, missing } = await loadRelations();
	console.log(
		`${relations.length} named walking routes in and around the Netherlands` +
			(missing ? ` (${missing} tiles not downloaded yet)` : '')
	);

	const seen = new Set<string>();
	// Wandelnet's walks, to spot OSM walks over the same ground (shown in the demo only).
	const onWandelnetGround = routeIndex(
		(
			db.prepare(`select geometry from walks where source = 'wandelnet'`).all() as {
				geometry: string;
			}[]
		).map((r) => JSON.parse(r.geometry))
	);
	let duplicates = 0;
	const save = (w: Omit<WalkRecord, 'source' | 'sourceId' | 'startPlace' | 'endPlace'>) => {
		if (seen.has(w.id)) return;
		const wandelnetDuplicate = onWandelnetGround(w.track) >= DUPLICATE_SHARE;
		if (wandelnetDuplicate) duplicates++;
		saveWalk(db, {
			...w,
			wandelnetDuplicate,
			source: 'osm',
			sourceId: w.id.slice('osm:'.length),
			startPlace: w.startStation && stationName(w.startStation),
			endPlace: w.endStation && stationName(w.endStation)
		});
		seen.add(w.id);
	};
	const common = {
		statedDistanceKm: null,
		accessibility: null,
		features: [],
		ratingAvg: null,
		reviewCount: 0,
		gpxUrl: null,
		photos: []
	};

	// LAW and streekpad stages, grouped per path.
	const paths = new Map<
		string,
		{
			name: string;
			collection: Collection;
			stages: { rel: OsmRelation; n: number; track: LngLat[] }[];
		}
	>();
	const singles: { rel: OsmRelation; collection: Collection }[] = [];
	let skipped = 0;
	for (const rel of relations) {
		const collection = classify(rel);
		if (!collection) {
			skipped++;
			continue;
		}
		const stage = collection === 'lokaal' ? null : stageOf(rel.tags.name);
		if (!stage) {
			singles.push({ rel, collection });
			continue;
		}
		const track = longest(stitch(rel));
		if (!track) continue;
		const key = `${collection}:${stage.path}`;
		if (!paths.has(key)) paths.set(key, { name: stage.path, collection, stages: [] });
		paths.get(key)!.stages.push({ rel, n: stage.stage, track });
	}

	let fromPaths = 0;
	for (const path of paths.values()) {
		path.stages.sort((a, b) => a.n - b.n);
		const chains = chainStages(path.stages.map((s) => ({ data: s, track: s.track })));
		for (const chain of chains)
			for (const [a, b] of pickSections(stationHits(chain.path, stations, STATION_RANGE_M))) {
				const used = [...new Set(chain.stageOf.slice(a.index, b.index + 1))].map(
					(i) => path.stages[i]
				);
				const operator = used[0].rel.tags.operator;
				save({
					...common,
					id: `osm:${slug(path.name)}:${a.code}-${b.code}`,
					collection: path.collection,
					name: `${path.name}: ${stationName(a.code)} – ${stationName(b.code)}`,
					startStation: a.code,
					endStation: b.code,
					startStationM: Math.round(a.metres),
					endStationM: Math.round(b.metres),
					isLoop: false,
					distanceKm: Math.round(sectionKm(a, b) * 10) / 10,
					description:
						`Deze dagwandeling volgt ${used.length > 1 ? 'etappes' : 'etappe'} ` +
						`${used.map((s) => twoDigits(s.n)).join(', ')} van het ${path.name}` +
						`${operator ? ` (${operator})` : ''}, zoals ingetekend in OpenStreetMap.`,
					track: chain.path.slice(a.index, b.index + 1),
					sourceUrl: relationUrl(used[0].rel.id)
				});
				fromPaths++;
			}
	}

	let loops = 0;
	let cut = 0;
	for (const { rel, collection } of singles) {
		stitch(rel)
			.filter((line) => lineLengthKm(line) >= 3)
			.forEach((line, part) => {
				const suffix = part ? `-${part}` : '';
				if (isClosed(line) || (rel.tags.roundtrip === 'yes' && isClosed(line, 1000))) {
					const hit = stationHits(line, stations, STATION_RANGE_M).reduce<
						ReturnType<typeof stationHits>[number] | null
					>((a, b) => (!a || b.metres < a.metres ? b : a), null);
					if (!hit) return;
					const km = lineLengthKm(line) + (2 * hit.metres) / 1000;
					if (km < LOOP_KM.min || km > LOOP_KM.max) return;
					save({
						...common,
						id: `osm:${rel.id}${suffix}`,
						collection,
						name: rel.tags.name,
						startStation: hit.code,
						endStation: hit.code,
						startStationM: Math.round(hit.metres),
						endStationM: Math.round(hit.metres),
						isLoop: true,
						distanceKm: Math.round(km * 10) / 10,
						description: about(rel.tags),
						track: rotateLoop(line, hit.index),
						sourceUrl: relationUrl(rel.id)
					});
					loops++;
					return;
				}
				const opts = collection === 'lokaal' ? LOCAL_SECTION : DEFAULT_SECTION;
				const hits = stationHits(line, stations, STATION_RANGE_M);
				for (const [a, b] of pickSections(hits, opts)) {
					const whole = hits.length === 2 && hits[0] === a && hits[1] === b;
					save({
						...common,
						id: `osm:${rel.id}${suffix}:${a.code}-${b.code}`,
						collection,
						name: whole
							? rel.tags.name
							: `${rel.tags.name}: ${stationName(a.code)} – ${stationName(b.code)}`,
						startStation: a.code,
						endStation: b.code,
						startStationM: Math.round(a.metres),
						endStationM: Math.round(b.metres),
						isLoop: false,
						distanceKm: Math.round(sectionKm(a, b) * 10) / 10,
						description: about(rel.tags),
						track: line.slice(a.index, b.index + 1),
						sourceUrl: relationUrl(rel.id)
					});
					cut++;
				}
			});
	}

	recordFetched(db, 'osm', oldestFetch());
	// A partial run doesn't know which walks are gone, only which it hasn't seen yet.
	const pruned = missing ? 0 : pruneStale(db, ['law', 'streekpad', 'lokaal'], seen, 'osm');
	console.log(
		`Stored ${seen.size} walks (${fromPaths} from ${paths.size} staged paths, ${loops} round walks, ` +
			`${cut} other sections, ${duplicates} also in Wandelnet's data); skipped ${skipped} routes (NS walks, other networks)` +
			`${pruned ? `; removed ${pruned} stale` : ''}.`
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
