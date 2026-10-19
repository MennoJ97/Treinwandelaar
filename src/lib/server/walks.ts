import type { DatabaseSync } from 'node:sqlite';
import { parseStretchId } from '../path';
import type {
	Collection,
	PathDetail,
	PathStop,
	WalkDetail,
	WalkListItem,
	WalkPhoto,
	WalkSource,
	WalkSummary
} from '../types';
import { getPath, plannedWalk } from './paths';

/* Row shape shared by the summary and detail queries. */
interface WalkRow {
	id: string;
	name: string;
	source: WalkSource;
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

function toListItem(r: WalkRow): WalkListItem {
	return {
		id: r.id,
		name: r.name,
		source: r.source,
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
		ownRating: r.own_rating
	};
}

const toSummary = (r: WalkRow): WalkSummary => ({
	...toListItem(r),
	geometry: JSON.parse(r.geometry)
});

/**
 * Which walks a viewer may see (`user` null: the anonymous demo). Wandelnet's and NS's data is for
 * the signed-in users only, so the demo shows just the walks built from OpenStreetMap (ODbL). Signed-in
 * users get everything except OSM's copies of walks Wandelnet's data already has (with its photos and
 * ratings); the OSM ingest marks those.
 */
const visibleTo = (user: string | null) =>
	user === null ? `w.source = 'osm'` : `not w.wandelnet_duplicate`;

/** YYYY-MM-DD of the last OpenStreetMap download, as recorded by the ingest. */
export function osmUpdated(db: DatabaseSync): string | null {
	const row = db.prepare(`select value from meta where key = 'fetched:osm'`).get() as
		{ value: string } | undefined;
	return row?.value ?? null;
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

/**
 * Every walk `user` may see, without its line: the lines are most of the bytes, and the page fetches
 * them on its own (walkLines), so its HTML stays small. The personal fields (status, own rating,
 * notes) are those of `user`; the demo has none.
 */
export function listWalks(db: DatabaseSync, user: string | null): WalkListItem[] {
	const rows = db
		.prepare(`${SELECT} where ${visibleTo(user)} order by w.name`)
		.all(user ?? '') as unknown as WalkRow[];
	return rows.map(toListItem);
}

/** The lines of the walks listWalks gives, as a JSON object of id → [[lng, lat], ...]. */
export function walkLines(db: DatabaseSync, user: string | null): string {
	const rows = db
		.prepare(`select w.id, w.geometry from walks w where ${visibleTo(user)}`)
		.all() as { id: string; geometry: string }[];
	// The column is JSON already: no need to parse a megabyte only to write it out again.
	return `{${rows.map((r) => `${JSON.stringify(r.id)}:${r.geometry}`).join(',')}}`;
}

/**
 * The walks an anonymous visitor may see, with the day their data last changed (YYYY-MM-DD, null
 * when unknown): the sitemap's URLs. Never Wandelnet's or NS's, which are for personal use only.
 */
export function publicWalks(db: DatabaseSync): { id: string; changedOn: string | null }[] {
	return db
		.prepare(
			`select w.id, w.changed_on as changedOn from walks w where ${visibleTo(null)} order by w.id`
		)
		.all() as unknown as { id: string; changedOn: string | null }[];
}

/** A walk with the stages of its path just before and after it, for the map's walk panel. */
export function withStages(db: DatabaseSync, walk: WalkDetail, user: string | null): WalkDetail {
	const { prev, next } = relatedWalks(db, walk, user);
	const slim = (w: StageLink | null) =>
		w && {
			id: w.id,
			name: w.name,
			startStationName: w.startStationName,
			endStationName: w.endStationName,
			startPlace: w.startPlace,
			endPlace: w.endPlace,
			distanceKm: w.distanceKm
		};
	return { ...walk, stages: { prev: slim(prev), next: slim(next) } };
}

/**
 * The version of a walk's link-preview card (data/og/, drawn by the OSM ingest), or null when it has
 * none. OpenStreetMap's walks only: the card shows the route to anyone who sees the link.
 */
export function walkCard(db: DatabaseSync, id: string): string | null {
	const row = db
		.prepare(`select og_card from walks w where w.id = ? and ${visibleTo(null)}`)
		.get(id) as { og_card: string | null } | undefined;
	return row?.og_card ?? null;
}

/** A stage before or after a walk; `planned` when it is a stretch planned on request (no page). */
export type StageLink = WalkListItem & { planned: boolean };

/**
 * The stage before (dir -1) or after (dir 1) the walk `id` on its path, in walking direction: a day
 * walk that joins on where there is one, or else a stretch from this walk's end to the stop closest
 * to where the path's own next stage ends (Pieterpad: Groningen, then Zuidlaren). Null at either end
 * of the path, or on a path without stages and no day walk to join.
 */
function neighbour(
	db: DatabaseSync,
	path: PathDetail,
	id: string,
	dir: 1 | -1,
	stored: WalkListItem[],
	user: string | null
): StageLink | null {
	const own = parseStretchId(id);
	const stop = (key: string) => path.stops.find((s) => s.key === key);
	const a = own && stop(own.from);
	const b = own && stop(own.to);
	if (!own || !a || !b || a.line !== b.line) return null;
	// Which way along the line the walk goes, and the end it carries on from.
	const way = b.km >= a.km ? 1 : -1;
	const end = dir === 1 ? b : a;
	const ahead = (km: number) => (km - end.km) * way * dir;
	const joins = stored.find((w) => {
		const e = parseStretchId(w.id)!;
		const other = stop(dir === 1 ? e.to : e.from);
		return (dir === 1 ? e.from : e.to) === end.key && !!other && ahead(other.km) > 0;
	});
	if (joins) return { ...joins, planned: false };
	// The path's own stage just past this end, and the stop nearest to where it ends.
	const onLine = path.stages.filter((s) => s.line === end.line);
	const stage = onLine.find((s) => {
		const [lo, hi] = [s.fromKm, s.toKm].sort((x, y) => x - y);
		const probe = end.km + 0.5 * way * dir;
		return probe >= lo && probe <= hi;
	});
	if (!stage) return null;
	const stageEnd =
		way * dir > 0 ? Math.max(stage.fromKm, stage.toKm) : Math.min(stage.fromKm, stage.toKm);
	const target = path.stops
		.filter((s) => s.line === end.line && ahead(s.km) > 2)
		.sort((x, y) => Math.abs(x.km - stageEnd) - Math.abs(y.km - stageEnd))[0];
	if (!target) return null;
	const stretch = `${path.id}:${dir === 1 ? `${end.key}-${target.key}` : `${target.key}-${end.key}`}`;
	const found = getWalk(db, stretch, user);
	if (!found) return null;
	const planned = !getWalk(db, stretch, user, { planned: false });
	const { geometry: _line, ...item } = found;
	return { ...(item as unknown as WalkListItem), planned };
}

/**
 * For a walk's own page: the day walks of the path it is a stretch of, in path order (with that
 * path's name, and the stages just before and after it), and other walks from or to its stations.
 */
export function relatedWalks(db: DatabaseSync, walk: WalkSummary, user: string | null) {
	const pathId = parseStretchId(walk.id)?.pathId ?? null;
	const path = pathId
		? (db
				.prepare(`select id, name, stops from paths w where id = ? and ${visibleTo(user)}`)
				.get(pathId) as { id: string; name: string; stops: string } | undefined)
		: undefined;
	let stages: WalkListItem[] = [];
	let prev: StageLink | null = null;
	let next: StageLink | null = null;
	if (path) {
		// Where each stop is along the path, to put its day walks in walking order.
		const at = new Map(
			(JSON.parse(path.stops) as PathStop[]).map((s) => [s.key, s.line * 1e6 + s.km])
		);
		const ends = (w: WalkListItem) => parseStretchId(w.id)!;
		const all = (
			db
				.prepare(`${SELECT} where ${visibleTo(user)} and substr(w.id, 1, ?) = ?`)
				.all(user ?? '', path.id.length + 1, `${path.id}:`) as unknown as WalkRow[]
		)
			.filter((r) => parseStretchId(r.id)?.pathId === path.id)
			.map(toListItem)
			.sort(
				(a, b) =>
					(at.get(ends(a).from) ?? Infinity) - (at.get(ends(b).from) ?? Infinity) ||
					a.name.localeCompare(b.name, 'nl')
			);
		stages = all.filter((w) => w.id !== walk.id);
		const detail = getPath(db, path.id, user);
		if (detail) {
			prev = neighbour(db, detail, walk.id, -1, stages, user);
			next = neighbour(db, detail, walk.id, 1, stages, user);
		}
	}
	const stations = [walk.startStation, walk.endStation].filter((s): s is string => !!s);
	const nearby = stations.length
		? (
				db
					.prepare(
						`${SELECT} where ${visibleTo(user)} and w.id <> ?
						 and (w.start_station in (?, ?) or w.end_station in (?, ?)) order by w.name limit 40`
					)
					.all(
						user ?? '',
						walk.id,
						stations[0],
						stations.at(-1)!,
						stations[0],
						stations.at(-1)!
					) as unknown as WalkRow[]
			)
				.map(toListItem)
				.filter((w) => !stages.some((s) => s.id === w.id))
				.slice(0, 12)
		: [];
	return { path: path ? { id: path.id, name: path.name } : null, stages, prev, next, nearby };
}

/**
 * A walk the ingest made (or you kept), or else a stretch of a path planned on request (unless
 * `planned` is false: a walk's own page is only for the walks that are stored).
 */
export function getWalk(
	db: DatabaseSync,
	id: string,
	user: string | null,
	{ planned = true } = {}
): WalkDetail | null {
	const r = db.prepare(`${SELECT} where w.id = ? and ${visibleTo(user)}`).get(user ?? '', id) as
		(WalkRow & Record<string, string | null>) | undefined;
	if (!r) return planned ? plannedWalk(db, id, user) : null;
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
		photos,
		along: r.along ? JSON.parse(r.along) : null
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
