/**
 * Feeder rides: the bus (or tram, metro, ferry) between a route end that is too far to walk and its
 * station. The GTFS feed has every Dutch operator; for each such walk end we look for trips that stop
 * near the route end and near the station, in the right order.
 */
import { haversine, type LngLat } from '../../src/lib/geo';

/** How far you'd walk from the route end to a stop, straight line. */
export const ROUTE_STOP_M = 800;
/** How far a stop may be from the station building: bus stations sit beside it, not in it. */
export const STATION_STOP_M = 500;

export interface FeederEnd {
	walkId: string;
	/** 'start': station → route start. 'end': route end → station. */
	side: 'start' | 'end';
	route: LngLat;
	station: LngLat;
}

export interface Stop {
	id: string;
	name: string;
	at: LngLat;
}

export interface StopTime {
	stopId: string;
	seq: number;
	arr: number;
	dep: number;
	/** False where the timetable says you can't get on (pickup_type 1) or off (drop_off_type 1). */
	pickup: boolean;
	dropOff: boolean;
	/** How far along the trip's shape (shape_dist_traveled), where the feed says. */
	dist?: number;
}

/** A point of a GTFS shape, with how far along it is in the same unit as StopTime.dist. */
export interface ShapePoint {
	at: LngLat;
	dist: number;
}

export interface Ride {
	board: StopTime;
	alight: StopTime;
	/** Straight-line metres between the stop and the route end. */
	stopM: number;
}

/** Stops within `maxM` of a point, by id, with their distance. */
export function stopsNear(stops: Stop[], point: LngLat, maxM: number): Map<string, number> {
	const near = new Map<string, number>();
	for (const s of stops) {
		const m = haversine(point, s.at);
		if (m <= maxM) near.set(s.id, m);
	}
	return near;
}

/**
 * The ride one trip offers for a walk end, or null: board and alight in travel order, and of all
 * such pairs the one with the least walking at both ends (a bus passing two stops near the station
 * lets you off at the closer one).
 */
export function feederRide(
	stopTimes: StopTime[],
	side: FeederEnd['side'],
	routeStops: Map<string, number>,
	stationStops: Map<string, number>
): Ride | null {
	const rows = [...stopTimes].sort((a, b) => a.seq - b.seq);
	const [fromStops, toStops] =
		side === 'end' ? [routeStops, stationStops] : [stationStops, routeStops];
	let best: Ride | null = null;
	let bestScore = Infinity;
	for (let i = 0; i < rows.length; i++) {
		const board = rows[i];
		const fromM = fromStops.get(board.stopId);
		if (fromM === undefined || !board.pickup) continue;
		for (let j = i + 1; j < rows.length; j++) {
			const alight = rows[j];
			const toM = toStops.get(alight.stopId);
			if (toM === undefined || !alight.dropOff || alight.stopId === board.stopId) continue;
			if (fromM + toM >= bestScore) continue;
			bestScore = fromM + toM;
			best = { board, alight, stopM: Math.round(side === 'end' ? fromM : toM) };
		}
	}
	return best;
}

/**
 * Where a ride runs along its trip's shape: the stretch between the distances of the stop you board
 * at and the one you get off at, its ends interpolated. Empty when the shape doesn't cover it.
 */
export function cutShape(points: ShapePoint[], from: number, to: number): LngLat[] {
	if (points.length < 2 || points.some((p) => !Number.isFinite(p.dist))) return [];
	// A stop may sit a metre past the shape's last point; the shape is still the right one.
	from = Math.max(from, points[0].dist);
	to = Math.min(to, points.at(-1)!.dist);
	if (!(to > from)) return [];
	const lerp = (a: ShapePoint, b: ShapePoint, d: number): LngLat => {
		const t = b.dist > a.dist ? (d - a.dist) / (b.dist - a.dist) : 0;
		return [a.at[0] + t * (b.at[0] - a.at[0]), a.at[1] + t * (b.at[1] - a.at[1])];
	};
	const line: LngLat[] = [];
	for (let i = 1; i < points.length; i++) {
		const [a, b] = [points[i - 1], points[i]];
		if (b.dist < from) continue;
		if (!line.length) line.push(lerp(a, b, from));
		if (b.dist >= to) {
			line.push(lerp(a, b, to));
			break;
		}
		line.push(b.at);
	}
	return line;
}

/**
 * Where a ride runs without a shape: from stop to stop, of the calls we have between boarding and
 * getting off (at least those two).
 */
export function stopsLine(
	calls: StopTime[],
	ride: Pick<Ride, 'board' | 'alight'>,
	stopAt: Map<string, LngLat>
): LngLat[] {
	return calls
		.filter((c) => c.seq >= ride.board.seq && c.seq <= ride.alight.seq)
		.sort((a, b) => a.seq - b.seq)
		.flatMap((c) => {
			const at = stopAt.get(c.stopId);
			return at ? [at] : [];
		});
}

/** Each stop within `maxM` of a station, with the station's code (the nearest, if several). */
export function stationStops(
	stops: Stop[],
	stations: { code: string; at: LngLat }[],
	maxM: number
): Map<string, string> {
	const byStop = new Map<string, string>();
	const closest = new Map<string, number>();
	for (const station of stations)
		for (const [id, m] of stopsNear(stops, station.at, maxM))
			if (m < (closest.get(id) ?? Infinity)) {
				closest.set(id, m);
				byStop.set(id, station.code);
			}
	return byStop;
}

/**
 * For a route end without a ride to its own station: the stations one trip does run to (or from,
 * for a start), with the shortest ride in seconds. The ingest uses this to suggest an override.
 */
export function stationsReached(
	stopTimes: StopTime[],
	side: FeederEnd['side'],
	routeStops: Map<string, number>,
	stationOf: Map<string, string>
): Map<string, number> {
	const rows = [...stopTimes].sort((a, b) => a.seq - b.seq);
	const reached = new Map<string, number>();
	for (let i = 0; i < rows.length; i++) {
		const board = rows[i];
		if (!board.pickup) continue;
		const fromStation = stationOf.get(board.stopId);
		if (side === 'end' ? !routeStops.has(board.stopId) : !fromStation) continue;
		for (let j = i + 1; j < rows.length; j++) {
			const alight = rows[j];
			if (!alight.dropOff) continue;
			const code = side === 'end' ? stationOf.get(alight.stopId) : fromStation;
			if (!code || (side === 'start' && !routeStops.has(alight.stopId))) continue;
			const s = alight.arr - board.dep;
			if (s < (reached.get(code) ?? Infinity)) reached.set(code, s);
		}
	}
	return reached;
}

const MODES: Record<string, string> = { '0': 'Tram', '1': 'Metro', '3': 'Bus', '4': 'Veerboot' };

/** GTFS route types we use for feeders: tram, metro, bus, ferry. Rail has its own planner. */
export const isFeederMode = (routeType: string) => routeType in MODES;

/** "Bus 136", "Metro B", "Veerboot" from a GTFS route. */
export function lineName(routeType: string, shortName: string): string {
	return `${MODES[routeType] ?? 'Bus'} ${shortName}`.trim();
}

/** A stage end needs some rides each way over the feed's two months: a bus most days, not once a week. */
export const MIN_TRIPS_EACH_WAY = 20;

/**
 * The station to reach a stage end from by bus, found in the timetable rather than assumed: of the
 * stations the trips calling near it run to and from, the one with at least `minTrips` rides each
 * way and the shortest typical ride there and back. Null when no bus serves it both ways.
 */
export function busStation(
	trips: StopTime[][],
	endStops: Map<string, number>,
	stationOf: Map<string, string>,
	minTrips = MIN_TRIPS_EACH_WAY
): { code: string; minutes: number } | null {
	const rides = new Map<string, { start: number[]; end: number[] }>();
	for (const calls of trips)
		for (const side of ['start', 'end'] as const)
			for (const [code, seconds] of stationsReached(calls, side, endStops, stationOf)) {
				let r = rides.get(code);
				if (!r) rides.set(code, (r = { start: [], end: [] }));
				r[side].push(seconds);
			}
	const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
	let best: { code: string; minutes: number } | null = null;
	for (const [code, { start, end }] of rides) {
		if (start.length < minTrips || end.length < minTrips) continue;
		const minutes = Math.round((median(start) + median(end)) / 2 / 60);
		if (!best || minutes < best.minutes) best = { code, minutes };
	}
	return best;
}
