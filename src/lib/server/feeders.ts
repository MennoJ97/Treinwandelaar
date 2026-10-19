import type { DatabaseSync } from 'node:sqlite';
import { addMinutes, amsterdamIso } from '../itinerary';
import { isStageEnd, parseStretchId } from '../path';
import type { FeederRide, Feeders } from '../types';

/** A time in GTFS seconds on a service day (YYYY-MM-DD) as an RFC3339 timestamp in Amsterdam. */
export function serviceTime(ymd: string, seconds: number): string {
	// From noon, so the day's own UTC offset applies (DST switches at night).
	return addMinutes(amsterdamIso(ymd, '12:00'), Math.round(seconds / 60) - 12 * 60);
}

interface Row {
	side: 'start' | 'end';
	line: string;
	operator: string | null;
	headsign: string | null;
	board: string;
	alight: string;
	dep: number;
	arr: number;
	stop_m: number;
	geometry: string | null;
}

/** Where a walk's rides for walking it the other way round are stored (scripts/ingest/gtfs.ts). */
export const reversedFeederId = (walkId: string) => `reverse:${walkId}`;

/**
 * Under which walk id the rides for each end are stored. A stretch of a path that starts or ends at a
 * stage end takes that stage end's rides, '<path id>:e3', whatever the other end; a stage end has
 * rides both ways, so turned around it is the other end's. Any other walk turned around has its own,
 * under reversedFeederId.
 */
export function feederKeys(walkId: string, reversed = false): { start: string; end: string } {
	const stretch = parseStretchId(walkId);
	const own = reversed ? reversedFeederId(walkId) : walkId;
	const key = (stop: string | undefined) =>
		stretch && stop && isStageEnd(stop) ? `${stretch.pathId}:${stop}` : own;
	const [from, to] = reversed ? [stretch?.to, stretch?.from] : [stretch?.from, stretch?.to];
	return { start: key(from), end: key(to) };
}

/**
 * The feeder rides for a walk on one day (YYYY-MM-DD), by departure, from scripts/ingest/gtfs.ts.
 * Reversed: for walking it from its end to its start, `start` and `end` as you'd walk it then.
 */
export function feederRides(
	db: DatabaseSync,
	walkId: string,
	ymd: string,
	reversed = false
): Feeders {
	const keys = feederKeys(walkId, reversed);
	const sides = new Set(
		(
			db
				.prepare(
					`select distinct side from feeder_trip
					 where (walk_id = ? and side = 'start') or (walk_id = ? and side = 'end')`
				)
				.all(keys.start, keys.end) as { side: string }[]
		).map((r) => r.side)
	);
	const feeders: Feeders = {
		start: sides.has('start') ? [] : null,
		end: sides.has('end') ? [] : null
	};
	if (!sides.size) return feeders;
	const rows = db
		.prepare(
			`select f.side, f.line, f.operator, f.headsign, f.board, f.alight, f.dep, f.arr, f.stop_m,
				g.geometry
			 from feeder_trip f
			 join feeder_service_date d on d.service_id = f.service_id and d.date = ?
			 left join feeder_geometry g on g.id = f.geometry_id
			 where (f.walk_id = ? and f.side = 'start') or (f.walk_id = ? and f.side = 'end')
			 order by f.dep, f.arr`
		)
		.all(ymd.replaceAll('-', ''), keys.start, keys.end) as unknown as Row[];
	// Most of a day's rides take the same few ways: parse each once.
	const geometries = new Map<string, [number, number][]>();
	const geometry = (json: string | null) => {
		if (!json) return [];
		let line = geometries.get(json);
		if (!line) geometries.set(json, (line = JSON.parse(json) as [number, number][]));
		return line;
	};
	for (const r of rows) {
		const list = feeders[r.side]!;
		const ride: FeederRide = {
			line: r.line,
			operator: r.operator,
			headsign: r.headsign,
			from: r.board,
			to: r.alight,
			departure: serviceTime(ymd, r.dep),
			arrival: serviceTime(ymd, r.arr),
			stopM: r.stop_m,
			geometry: geometry(r.geometry)
		};
		// Two lines running the same stretch at the same minute (or a trip listed twice): show one.
		const last = list.at(-1);
		if (last && last.departure === ride.departure && last.arrival === ride.arrival) continue;
		list.push(ride);
	}
	return feeders;
}
