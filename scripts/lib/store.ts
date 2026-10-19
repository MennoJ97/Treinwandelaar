import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../src/lib/server/db';
import { lineLengthKm, simplify, type LngLat } from '../../src/lib/geo';
import type { Collection, PathStage, PathStop, WalkSource } from '../../src/lib/types';

export interface WalkRecord {
	id: string;
	/** Default 'wandelnet'. */
	source?: WalkSource;
	/** An OSM walk that Wandelnet's data has too: shown in the demo only. */
	wandelnetDuplicate?: boolean;
	sourceId: string;
	collection: Collection;
	name: string;
	startPlace: string | null;
	endPlace: string | null;
	startStation: string | null;
	endStation: string | null;
	startStationM: number | null;
	endStationM: number | null;
	isLoop: boolean;
	distanceKm: number;
	statedDistanceKm: number | null;
	description: string | null;
	accessibility: string | null;
	features: string[];
	track: LngLat[];
	ratingAvg: number | null;
	reviewCount: number;
	sourceUrl: string;
	gpxUrl: string | null;
	photos: { url: string; caption: string | null }[];
}

/**
 * What a walk's page shows: when one of these changes, so does the walk's changed_on (the sitemap's
 * lastmod). Not updated_at, which every ingest rewrites, nor wandelnet_duplicate, which only decides
 * who sees the walk.
 */
const CONTENT_COLUMNS = [
	'collection',
	'name',
	'start_place',
	'end_place',
	'start_station',
	'end_station',
	'start_station_m',
	'end_station_m',
	'is_loop',
	'distance_km',
	'stated_distance_km',
	'description',
	'accessibility',
	'features',
	'geometry',
	'rating_avg',
	'review_count',
	'source_url',
	'gpx_url'
];

const UPSERT = `
	insert into walks (id, source, source_id, ${CONTENT_COLUMNS.join(', ')}, wandelnet_duplicate,
		updated_at, changed_on)
	values (?, ?, ?, ${CONTENT_COLUMNS.map(() => '?').join(', ')}, ?, datetime('now'), date('now'))
	on conflict(id) do update set
		${CONTENT_COLUMNS.map((c) => `${c} = excluded.${c}`).join(', ')},
		wandelnet_duplicate = excluded.wandelnet_duplicate, updated_at = excluded.updated_at,
		-- Every assignment reads the row as it was, so this compares old and new content.
		changed_on = case when ${CONTENT_COLUMNS.map((c) => `walks.${c} is not excluded.${c}`).join(' or ')}
			then excluded.changed_on else walks.changed_on end`;

/** Simplified to ~8 m and rounded to ~1 m: small enough to ship every route to the map at once. */
export function compactGeometry(track: LngLat[]): LngLat[] {
	return simplify(track, 8).map(([lng, lat]) => [
		Math.round(lng * 1e5) / 1e5,
		Math.round(lat * 1e5) / 1e5
	]);
}

export function saveWalk(db: DatabaseSync, w: WalkRecord) {
	transaction(db, () => {
		db.prepare(UPSERT).run(
			w.id,
			w.source ?? 'wandelnet',
			w.sourceId,
			w.collection,
			w.name,
			w.startPlace,
			w.endPlace,
			w.startStation,
			w.endStation,
			w.startStationM,
			w.endStationM,
			w.isLoop ? 1 : 0,
			w.distanceKm,
			w.statedDistanceKm,
			w.description,
			w.accessibility,
			JSON.stringify(w.features),
			JSON.stringify(compactGeometry(w.track)),
			w.ratingAvg,
			w.reviewCount,
			w.sourceUrl,
			w.gpxUrl,
			w.wandelnetDuplicate ? 1 : 0
		);
		const source = w.source ?? 'wandelnet';
		db.prepare(`delete from walk_photos where walk_id = ? and source = ?`).run(w.id, source);
		const insert = db.prepare(
			`insert or ignore into walk_photos (walk_id, url, caption, source, sort) values (?, ?, ?, ?, ?)`
		);
		w.photos.forEach((p, i) => insert.run(w.id, p.url, p.caption, source, i));
	});
}

/**
 * Remember how current a source's data is (`meta` key `fetched:<source>`, YYYY-MM-DD), for the
 * credit line in the app. Pass the oldest download the run used, not the time of the run: re-runs
 * mostly read the raw cache.
 */
export function recordFetched(db: DatabaseSync, source: string, at: Date | null) {
	if (!at) return;
	db.prepare('insert or replace into meta (key, value) values (?, ?)').run(
		`fetched:${source}`,
		at.toISOString().slice(0, 10)
	);
}

/**
 * Remove walks of these collections from `source` that this run no longer produced (e.g. a path was
 * re-cut), except ones someone marked or rated.
 */
export function pruneStale(
	db: DatabaseSync,
	collections: Collection[],
	keepIds: Set<string>,
	source: WalkSource = 'wandelnet'
) {
	const placeholders = collections.map(() => '?').join(', ');
	const rows = db
		.prepare(
			`select id from walks where source = ? and collection in (${placeholders})
			 and id not in (select walk_id from user_walk)`
		)
		.all(source, ...collections) as { id: string }[];
	const stale = rows.filter((r) => !keepIds.has(r.id));
	const del = db.prepare('delete from walks where id = ?');
	transaction(db, () => stale.forEach((r) => del.run(r.id)));
	return stale.length;
}

export interface PathRecord {
	id: string;
	source: WalkSource;
	collection: Collection;
	name: string;
	/** Already simplified (see plannerLine), so the stops' indices point into them. */
	lines: LngLat[][];
	stops: PathStop[];
	stages: PathStage[];
	sourceUrl: string;
	wandelnetDuplicate?: boolean;
}

/** A whole path, for planning your own stretches of it (src/lib/path.ts). */
export function savePath(db: DatabaseSync, p: PathRecord) {
	db.prepare(
		`insert or replace into paths (id, source, collection, name, km, lines, stops, stages, source_url,
			wandelnet_duplicate, updated_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
	).run(
		p.id,
		p.source,
		p.collection,
		p.name,
		Math.round(p.lines.reduce((sum, l) => sum + lineLengthKm(l), 0) * 10) / 10,
		JSON.stringify(p.lines),
		JSON.stringify(p.stops),
		JSON.stringify(p.stages),
		p.sourceUrl,
		p.wandelnetDuplicate ? 1 : 0
	);
}

/** Remove paths from `source` that this run no longer produced. */
export function prunePaths(db: DatabaseSync, source: WalkSource, keepIds: Set<string>) {
	const ids = (db.prepare('select id from paths where source = ?').all(source) as { id: string }[])
		.map((r) => r.id)
		.filter((id) => !keepIds.has(id));
	const del = db.prepare('delete from paths where id = ?');
	transaction(db, () => ids.forEach((id) => del.run(id)));
	return ids.length;
}
