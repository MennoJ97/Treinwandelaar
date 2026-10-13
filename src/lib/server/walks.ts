import type { DatabaseSync } from 'node:sqlite';
import type { Collection, WalkDetail, WalkPhoto, WalkSummary } from '../types';

/* Row shape shared by the summary and detail queries. */
interface WalkRow {
	id: string;
	name: string;
	collection: Collection;
	start_station: string | null;
	end_station: string | null;
	start_station_name: string | null;
	end_station_name: string | null;
	start_place: string | null;
	end_place: string | null;
	start_station_m: number | null;
	end_station_m: number | null;
	is_loop: number;
	distance_km: number;
	paved_pct: number | null;
	rating_avg: number | null;
	review_count: number;
	thumbnail: string | null;
	status: 'wishlist' | 'done' | null;
	own_rating: number | null;
	geometry: string;
}

const SELECT = `
	select w.*, s1.name as start_station_name, s2.name as end_station_name,
		u.status, u.own_rating, u.notes,
		(select url from walk_photos p where p.walk_id = w.id order by sort limit 1) as thumbnail
	from walks w
	left join stations s1 on s1.code = w.start_station
	left join stations s2 on s2.code = w.end_station
	left join user_walk u on u.walk_id = w.id and u.username = ?`;

function toSummary(r: WalkRow): WalkSummary {
	return {
		id: r.id,
		name: r.name,
		collection: r.collection,
		startStation: r.start_station,
		endStation: r.end_station,
		startStationName: r.start_station_name,
		endStationName: r.end_station_name,
		startPlace: r.start_place,
		endPlace: r.end_place,
		startStationM: r.start_station_m,
		endStationM: r.end_station_m,
		isLoop: !!r.is_loop,
		distanceKm: r.distance_km,
		pavedPct: r.paved_pct,
		ratingAvg: r.rating_avg,
		reviewCount: r.review_count,
		thumbnail: r.thumbnail,
		status: r.status,
		ownRating: r.own_rating,
		geometry: JSON.parse(r.geometry)
	};
}

/**
 * How current the Wandelnet route data is (YYYY-MM-DD): the oldest download behind the NS walks and
 * the streekpad/LAW sections, as recorded by the ingest. Null before the first ingest records it.
 */
export function wandelnetUpdated(db: DatabaseSync): string | null {
	const row = db
		.prepare(`select min(value) as date from meta where key like 'fetched:wandelnet%'`)
		.get() as { date: string | null } | undefined;
	return row?.date ?? null;
}

/* The personal fields (status, own rating, notes) are those of `user`. */
export function listWalks(db: DatabaseSync, user: string) {
	const rows = db.prepare(`${SELECT} order by w.name`).all(user) as unknown as WalkRow[];
	return rows.map(toSummary);
}

export function getWalk(db: DatabaseSync, id: string, user: string): WalkDetail | null {
	const r = db.prepare(`${SELECT} where w.id = ?`).get(user, id) as
		(WalkRow & Record<string, string | null>) | undefined;
	if (!r) return null;
	const photos = db
		.prepare('select url, caption, source from walk_photos where walk_id = ? order by sort')
		.all(id) as unknown as WalkPhoto[];
	return {
		...toSummary(r),
		description: r.description,
		accessibility: r.accessibility,
		features: JSON.parse(r.features ?? '[]'),
		dogs: r.dogs,
		sourceUrl: r.source_url!,
		nsUrl: r.ns_url,
		gpxUrl: r.gpx_url,
		notes: r.notes,
		photos
	};
}

export interface UserWalkUpdate {
	status?: 'wishlist' | 'done' | null;
	ownRating?: number | null;
	notes?: string | null;
}

export function updateUserWalk(db: DatabaseSync, user: string, id: string, update: UserWalkUpdate) {
	const current = (db
		.prepare('select * from user_walk where username = ? and walk_id = ?')
		.get(user, id) ?? {}) as {
		status?: string | null;
		own_rating?: number | null;
		notes?: string | null;
		done_date?: string | null;
	};
	const status = update.status !== undefined ? update.status : (current.status ?? null);
	const doneDate =
		status === 'done' && current.status !== 'done'
			? new Date().toISOString().slice(0, 10)
			: status === 'done'
				? (current.done_date ?? null)
				: null;
	db.prepare(
		`insert into user_walk (username, walk_id, status, own_rating, notes, done_date)
		 values (?, ?, ?, ?, ?, ?)
		 on conflict(username, walk_id) do update set status = excluded.status, own_rating = excluded.own_rating,
			notes = excluded.notes, done_date = excluded.done_date`
	).run(
		user,
		id,
		status,
		update.ownRating !== undefined ? update.ownRating : (current.own_rating ?? null),
		update.notes !== undefined ? update.notes : (current.notes ?? null),
		doneDate
	);
}
