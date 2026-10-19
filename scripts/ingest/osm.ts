/**
 * Ingest walking routes from OpenStreetMap as station-to-station (or station-round) day walks: the
 * walks of the public demo, and for signed-in users every one that Wandelnet's data doesn't already
 * cover (see routeIndex). ODbL, © OpenStreetMap contributors.
 *
 * - LAW routes (network=nwn) and streekpaden (rwn) are mapped stage by stage; like ../ingest/paden.ts we
 *   join the stages and cut the line into sections between stations.
 * - Local walks (lwn): round walks that pass a station start there; others are cut like a path.
 * - LAW routes and streekpaden are also kept whole, so the app can plan any stretch between two
 *   stations they pass (src/lib/path.ts).
 * - NS-wandelingen are skipped (see isNsWalk), and so are knooppunt links and side branches.
 *
 * The routes come from Geofabrik's extract of the Netherlands, filtered with osmium (see
 * ../lib/extract.ts); it is downloaded again when older than six days, or with --refresh.
 */
import { dirname, join } from 'node:path';
import { openDb } from '../../src/lib/server/db';
import { lineLengthKm, type LngLat } from '../../src/lib/geo';
import type { Collection, Station } from '../../src/lib/types';
import { cardHost, CARD_DIR, renderCards } from '../lib/cards';
import { alongOf } from '../../src/lib/along';
import { walkContext } from '../lib/context';
import { contextFeatures, hikingRoutes } from '../lib/extract';
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
import {
	chainStages,
	DEFAULT_SECTION,
	pickSections,
	plannerLine,
	sectionKm,
	stationHits,
	type SectionOptions
} from '../lib/sections';
import {
	prunePaths,
	pruneStale,
	recordFetched,
	savePath,
	saveWalk,
	type PathRecord,
	type WalkRecord
} from '../lib/store';

/** How far a station may be from the route: this bit is walked extra, to/from the platform. */
const STATION_RANGE_M = 1500;
/** Local walks are shorter than a stretch of LAW. */
const LOCAL_SECTION: SectionOptions = { minKm: 5, targetKm: 12, maxKm: 26 };
const LOOP_KM = { min: 4, max: 30 };

/** Where the extract and its filtered copies live: next to the database. */
const EXTRACT_DIR = join(dirname(process.env.DATABASE_PATH ?? 'data/treinwandelaar.db'), 'osm');

const relationUrl = (id: number) => `https://www.openstreetmap.org/relation/${id}`;
const slug = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
const twoDigits = (n: number) => String(n).padStart(2, '0');

/** "Route van Utrechts Landschap." plus OSM's own description, if any. */
function about(tags: Record<string, string>): string | null {
	const parts = [tags.description, tags.operator && `Route van ${tags.operator}.`];
	return parts.filter(Boolean).join(' ') || null;
}

/** The longest stitched line: stages are drawn as one line plus the odd stray bit. */
const longest = (lines: LngLat[][]) =>
	lines.reduce<LngLat[] | null>((a, b) => (!a || lineLengthKm(b) > lineLengthKm(a) ? b : a), null);

async function main() {
	const db = openDb();
	const stations = db.prepare('select * from stations').all() as unknown as Station[];
	if (!stations.length) throw new Error('No stations; run `npm run ingest:stations` first.');
	const stationName = (code: string) => stations.find((s) => s.code === code)?.name ?? code;

	const { relations, dataFrom } = await hikingRoutes(EXTRACT_DIR);
	console.log(
		`${relations.length} walking routes in the extract, data from ${dataFrom.toISOString()}`
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
	// The same for whole paths: an OSM path over Wandelnet's ground is planned on Wandelnet's copy.
	const onWandelnetPath = routeIndex(
		(
			db.prepare(`select lines from paths where source = 'wandelnet'`).all() as { lines: string }[]
		).flatMap((r) => JSON.parse(r.lines))
	);
	const seenPaths = new Set<string>();
	const keepPath = (p: Omit<PathRecord, 'source' | 'wandelnetDuplicate'>) => {
		if (seenPaths.has(p.id) || !p.lines.length) return;
		savePath(db, {
			...p,
			source: 'osm',
			wandelnetDuplicate: onWandelnetPath(p.lines.flat()) >= DUPLICATE_SHARE
		});
		seenPaths.add(p.id);
	};
	// Saved at the end, once we know what each walk passes (walkContext).
	const walks: WalkRecord[] = [];
	const save = (w: Omit<WalkRecord, 'source' | 'sourceId' | 'startPlace' | 'endPlace'>) => {
		if (seen.has(w.id)) return;
		const wandelnetDuplicate = onWandelnetGround(w.track) >= DUPLICATE_SHARE;
		if (wandelnetDuplicate) duplicates++;
		walks.push({
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
		const planner = chains.map((chain, n) =>
			plannerLine(
				chain,
				path.stages.map((s) => ({
					number: s.n,
					places: s.rel.tags.from && s.rel.tags.to ? `${s.rel.tags.from} – ${s.rel.tags.to}` : null,
					url: relationUrl(s.rel.id)
				})),
				stations,
				n
			)
		);
		keepPath({
			id: `osm:${slug(path.name)}`,
			collection: path.collection,
			name: path.name,
			lines: planner.map((p) => p.line),
			stops: planner.flatMap((p) => p.stops),
			stages: planner.flatMap((p) => p.stages),
			sourceUrl: relationUrl(path.stages[0].rel.id)
		});
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
		const lines = stitch(rel).filter((line) => lineLengthKm(line) >= 3);
		if (collection !== 'lokaal') {
			const planner = lines.map((line, n) =>
				plannerLine({ path: line, stageOf: line.map(() => 0) }, [], stations, n)
			);
			keepPath({
				id: `osm:${rel.id}`,
				collection,
				name: rel.tags.name,
				lines: planner.map((p) => p.line),
				stops: planner.flatMap((p) => p.stops),
				stages: [],
				sourceUrl: relationUrl(rel.id)
			});
		}
		lines.forEach((line, part) => {
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

	recordFetched(db, 'osm', dataFrom);
	const pruned = pruneStale(db, ['law', 'streekpad', 'lokaal'], seen, 'osm');
	const prunedPaths = prunePaths(db, 'osm', seenPaths);

	// What each walk passes: the route ways it follows (surface), then the landscape around it.
	// Wandelnet's walks too (seen only signed in), the stretches someone kept, and every path line,
	// so that a stretch planned on request can say what it passes (src/lib/along.ts).
	const others = (
		db.prepare('select id, geometry from walks').all() as { id: string; geometry: string }[]
	).filter((r) => !seen.has(r.id));
	const pathLines = (
		db.prepare('select id, lines from paths').all() as { id: string; lines: string }[]
	).map((r) => ({ id: r.id, lines: JSON.parse(r.lines) as LngLat[][] }));
	const context = walkContext([
		...walks.map((w) => w.track),
		...others.map((r) => JSON.parse(r.geometry) as LngLat[]),
		...pathLines.flatMap((p) => p.lines)
	]);
	for (const rel of relations)
		for (const m of rel.members)
			if (m.type === 'way' && m.geometry && m.tags)
				context.addWay(
					m.geometry.map((p): LngLat => [p.lon, p.lat]),
					m.tags
				);
	// Done with the routes and their ways (most of the memory): let them go before the features.
	relations.length = 0;
	let features = 0;
	for await (const f of contextFeatures(EXTRACT_DIR)) {
		context.addFeature(f);
		features++;
	}
	const profiles = context.done();
	walks.forEach((w, i) => saveWalk(db, { ...w, along: alongOf(profiles[i]) }));
	const setAlong = db.prepare(
		`update walks set changed_on = case when along is not ?1 then date('now') else changed_on end,
			along = ?1 where id = ?2`
	);
	others.forEach((r, i) => setAlong.run(JSON.stringify(alongOf(profiles[walks.length + i])), r.id));
	const setProfile = db.prepare('update paths set profile = ? where id = ?');
	let at = walks.length + others.length;
	for (const p of pathLines) {
		setProfile.run(JSON.stringify(profiles.slice(at, at + p.lines.length)), p.id);
		at += p.lines.length;
	}
	console.log(
		`Matched ${features} OSM features against ${walks.length} OSM walks, ${others.length} others and ` +
			`${pathLines.length} paths for what they pass.`
	);

	const cards = await renderCards(db, CARD_DIR, cardHost());
	console.log(
		`Link-preview cards: ${cards.drawn} drawn, ${cards.deleted} deleted, of ${cards.walks}.`
	);
	console.log(
		`Stored ${seen.size} walks (${fromPaths} from ${paths.size} staged paths, ${loops} round walks, ` +
			`${cut} other sections, ${duplicates} also in Wandelnet's data); skipped ${skipped} routes (NS walks, other networks)` +
			`${pruned ? `; removed ${pruned} stale` : ''}. ${seenPaths.size} paths to plan your own stretches on` +
			`${prunedPaths ? ` (removed ${prunedPaths})` : ''}.`
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
