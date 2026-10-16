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
