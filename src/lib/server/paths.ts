import type { DatabaseSync } from 'node:sqlite';
import { parseStretchId, planStretch, stageList } from '../path';
import type {
	Collection,
	PathDetail,
	PathStop,
	PathSummary,
	WalkDetail,
	WalkSource
} from '../types';

interface PathRow {
	id: string;
	source: WalkSource;
	collection: Collection;
	name: string;
	km: number;
	lines: string;
	stops: string;
	stages: string;
	source_url: string;
}

/** Like the walks (see visibleTo in walks.ts): the demo gets OpenStreetMap's paths only. */
const visibleTo = (user: string | null) =>
	user === null ? `source = 'osm'` : `not wandelnet_duplicate`;

/** Every path with at least two stops (stations or stage ends by bus), without its line: for the route filter. */
export function listPaths(db: DatabaseSync, user: string | null): PathSummary[] {
	return db
		.prepare(
			`select id, source, collection, name, km from paths
			 where ${visibleTo(user)} and json_array_length(stops) +
				(select count(*) from path_bus_stop b where b.path_id = paths.id) >= 2
			 order by name`
		)
		.all() as unknown as PathSummary[];
}

/** The stage ends of a path that a bus runs to, as stops (see path_bus_stop). */
function busStops(db: DatabaseSync, pathId: string): PathStop[] {
	return db
		.prepare(
			`select b.key, b.station as code, s.name, b.place, b.line, b.idx as "index", b.km, b.metres
			 from path_bus_stop b join stations s on s.code = b.station where b.path_id = ?`
		)
		.all(pathId) as unknown as PathStop[];
}

export function getPath(db: DatabaseSync, id: string, user: string | null): PathDetail | null {
	const r = db.prepare(`select * from paths where id = ? and ${visibleTo(user)}`).get(id) as
		PathRow | undefined;
	if (!r) return null;
	return {
		id: r.id,
		source: r.source,
		collection: r.collection,
		name: r.name,
		km: r.km,
		// Stations and bus-served stage ends together, in path order.
		stops: [...(JSON.parse(r.stops) as PathStop[]), ...busStops(db, id)].sort(
			(a, b) => a.line - b.line || a.km - b.km
		),
		lines: JSON.parse(r.lines),
		stages: JSON.parse(r.stages),
		sourceUrl: r.source_url
	};
}

/**
 * A stretch of a path that the ingest didn't cut as a day walk, planned on request: 'pad:<slug>:WSM-GN'
 * is the path from Winsum to Groningen, 'pad:<slug>:GN-e2' from Groningen to the end of the third
 * stage, with the bus from there. Null when the id names no path or stops on it.
 */
export function plannedWalk(db: DatabaseSync, id: string, user: string | null): WalkDetail | null {
	const parsed = parseStretchId(id);
	const path = parsed && getPath(db, parsed.pathId, user);
	const stretch = path && planStretch(path, parsed.from, parsed.to);
	if (!stretch) return null;
	const { from, to } = stretch;
	const range = [from.km, to.km].sort((a, b) => a - b).map((km) => Math.round(km));
	return {
		id,
		name: `${path.name}: ${from.place ?? from.name} – ${to.place ?? to.name}`,
		source: path.source,
		collection: path.collection,
		startStation: from.code,
		endStation: to.code,
		startStationName: from.name,
		endStationName: to.name,
		startPlace: from.place ?? from.name,
		endPlace: to.place ?? to.name,
		startStationM: from.metres,
		endStationM: to.metres,
		isLoop: false,
		distanceKm: stretch.km,
		pavedPct: null,
		ratingAvg: null,
		reviewCount: 0,
		thumbnail: null,
		status: null,
		ownRating: null,
		geometry: stretch.track,
		description:
			`Zelf uitgezet stuk van het ${path.name}, van km ${range[0]} tot ${range[1]}` +
			`${stretch.reversed ? ', tegen de richting van de route in' : ''}` +
			`${stretch.stages.length ? `, langs ${stageList(stretch.stages)}` : ''}.`,
		accessibility: null,
		features: [],
		dogs: null,
		sourceUrl: stretch.stages[0]?.url ?? path.sourceUrl,
		nsUrl: null,
		gpxUrl: null,
		photos: [],
		notes: null
	};
}

/**
 * Save a planned stretch as a walk of its own, so it can carry your status, rating and notes (and
 * shows in the list from then on). The ingest's pruning leaves walks with a personal layer alone.
 */
export function keepPlannedWalk(db: DatabaseSync, walk: WalkDetail) {
	db.prepare(
		`insert or ignore into walks (id, source, source_id, collection, name, start_place, end_place,
			start_station, end_station, start_station_m, end_station_m, is_loop, distance_km, description,
			features, geometry, review_count, source_url, updated_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, '[]', ?, 0, ?, datetime('now'))`
	).run(
		walk.id,
		walk.source,
		walk.id.slice(walk.id.indexOf(':') + 1),
		walk.collection,
		walk.name,
		walk.startPlace,
		walk.endPlace,
		walk.startStation,
		walk.endStation,
		walk.startStationM,
		walk.endStationM,
		walk.distanceKm,
		walk.description,
		JSON.stringify(walk.geometry),
		walk.sourceUrl
	);
}
