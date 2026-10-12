import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../src/lib/server/db';
import { simplify, type LngLat } from '../../src/lib/geo';
import type { Collection } from '../../src/lib/types';

export interface WalkRecord {
	id: string;
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

const UPSERT = `
	insert into walks (id, source, source_id, collection, name, start_place, end_place, start_station,
		end_station, start_station_m, end_station_m, is_loop, distance_km, stated_distance_km, description,
		accessibility, features, geometry, rating_avg, review_count, source_url, gpx_url, updated_at)
	values (?, 'wandelnet', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
	on conflict(id) do update set collection = excluded.collection, name = excluded.name,
		start_place = excluded.start_place, end_place = excluded.end_place,
		start_station = excluded.start_station, end_station = excluded.end_station,
		start_station_m = excluded.start_station_m, end_station_m = excluded.end_station_m,
		is_loop = excluded.is_loop, distance_km = excluded.distance_km,
		stated_distance_km = excluded.stated_distance_km, description = excluded.description,
		accessibility = excluded.accessibility, features = excluded.features, geometry = excluded.geometry,
		rating_avg = excluded.rating_avg, review_count = excluded.review_count,
		source_url = excluded.source_url, gpx_url = excluded.gpx_url, updated_at = excluded.updated_at`;

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
			w.gpxUrl
		);
		db.prepare(`delete from walk_photos where walk_id = ? and source = 'wandelnet'`).run(w.id);
		const insert = db.prepare(
			`insert or ignore into walk_photos (walk_id, url, caption, source, sort) values (?, ?, ?, 'wandelnet', ?)`
		);
		w.photos.forEach((p, i) => insert.run(w.id, p.url, p.caption, i));
	});
}

/**
 * Remove walks of these collections that this run no longer produced (e.g. a path was re-cut),
 * except ones you marked or rated yourself.
 */
export function pruneStale(db: DatabaseSync, collections: Collection[], keepIds: Set<string>) {
	const placeholders = collections.map(() => '?').join(', ');
	const rows = db
		.prepare(
			`select id from walks where collection in (${placeholders})
			 and id not in (select walk_id from user_walk)`
		)
		.all(...collections) as { id: string }[];
	const stale = rows.filter((r) => !keepIds.has(r.id));
	const del = db.prepare('delete from walks where id = ?');
	transaction(db, () => stale.forEach((r) => del.run(r.id)));
	return stale.length;
}
