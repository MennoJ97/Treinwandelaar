/**
 * Offline rail planner over the GTFS timetable (scripts/ingest/gtfs.ts): the Connection Scan
 * Algorithm. A day's timetable is a list of "connections" (one train between two consecutive
 * stops) sorted by departure; one pass over it gives the earliest arrival at every station.
 *
 * "Fastest trip" is measured the way NS reports it: from the first train you board to arrival,
 * so waiting at home doesn't count. We scan several departure times and keep the shortest.
 */
import type { DatabaseSync } from 'node:sqlite';

/** Changing trains takes time; staying on the same train doesn't. */
export const TRANSFER_SECONDS = 180;

export interface Day {
	/** Station index ↔ NS code. */
	codes: string[];
	index: Map<string, number>;
	/** Connections, sorted by departure. Parallel arrays for speed. */
	dep: Int32Array;
	arr: Int32Array;
	from: Int32Array;
	to: Int32Array;
	trip: Int32Array;
	tripName: Map<number, string>;
	/** Connection indices sorted by arrival, latest first, for planning backwards from a deadline. */
	byArrivalDesc: Int32Array;
}

export interface Route {
	minutes: number;
	transfers: number;
	departure: number; // seconds after midnight
	/** Every stretch travelled, as [fromCode, toCode], for matching disruptions. */
	edges: [string, string][];
	/** Train names per leg, e.g. ["Intercity", "Sprinter"]. */
	legs: string[];
}

/** Build a day's connections from rows (trip, seq, code, arr, dep) ordered by trip and seq. */
export function buildDay(
	rows: { trip_id: number; code: string; arr: number; dep: number; name?: string | null }[]
): Day {
	const codes: string[] = [];
	const index = new Map<string, number>();
	const idx = (code: string) => {
		let i = index.get(code);
		if (i === undefined) {
			i = codes.length;
			codes.push(code);
			index.set(code, i);
		}
		return i;
	};
	const list: [number, number, number, number, number][] = [];
	const tripName = new Map<number, string>();
	for (let i = 1; i < rows.length; i++) {
		const a = rows[i - 1];
		const b = rows[i];
		if (a.trip_id !== b.trip_id) continue;
		if (b.arr < a.dep) continue; // bad data guard
		list.push([a.dep, b.arr, idx(a.code), idx(b.code), a.trip_id]);
		if (a.name) tripName.set(a.trip_id, a.name);
	}
	list.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
	const n = list.length;
	const day: Day = {
		codes,
		index,
		dep: new Int32Array(n),
		arr: new Int32Array(n),
		from: new Int32Array(n),
		to: new Int32Array(n),
		trip: new Int32Array(n),
		tripName,
		byArrivalDesc: new Int32Array(n)
	};
	list.forEach(([d, a, f, t, tr], i) => {
		day.dep[i] = d;
		day.arr[i] = a;
		day.from[i] = f;
		day.to[i] = t;
		day.trip[i] = tr;
	});
	const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => day.arr[y] - day.arr[x]);
	day.byArrivalDesc.set(order);
	return day;
}

/**
 * Earliest arrival at every station leaving `origin` at `start` or later. Returns, per station,
 * the arrival time and the connection that got us there, plus where each trip was boarded.
 */
function scan(day: Day, origin: number, start: number) {
	const n = day.codes.length;
	const arrival = new Float64Array(n).fill(Infinity);
	const via = new Int32Array(n).fill(-1);
	const boardedAt = new Map<number, number>(); // trip → index of the connection where we boarded
	arrival[origin] = start;
	// A journey is at most a few hours; stop scanning well after the latest useful departure.
	const horizon = start + 8 * 3600;
	for (let c = lowerBound(day.dep, start); c < day.dep.length; c++) {
		const dep = day.dep[c];
		if (dep > horizon) break;
		const trip = day.trip[c];
		const from = day.from[c];
		const onBoard = boardedAt.has(trip);
		if (!onBoard) {
			const slack = from === origin ? 0 : TRANSFER_SECONDS;
			if (arrival[from] + slack > dep) continue;
			boardedAt.set(trip, c);
		}
		const to = day.to[c];
		if (day.arr[c] < arrival[to]) {
			arrival[to] = day.arr[c];
			via[to] = c;
		}
	}
	return { arrival, via, boardedAt };
}

function lowerBound(sorted: Int32Array, value: number): number {
	let lo = 0;
	let hi = sorted.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid] < value) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** Walk back from `target` leg by leg: the train that arrived, where it was boarded, and so on. */
function reconstruct(
	day: Day,
	origin: number,
	target: number,
	via: Int32Array,
	boardedAt: Map<number, number>
): Route | null {
	const edges: [string, string][] = [];
	const legs: string[] = [];
	let station = target;
	let firstDeparture = Infinity;
	let arrival = -1;
	let guard = 0;
	while (station !== origin) {
		const c = via[station];
		if (c < 0 || guard++ > 20) return null;
		if (arrival < 0) arrival = day.arr[c];
		const trip = day.trip[c];
		const board = boardedAt.get(trip)!;
		// Every connection of this trip between boarding and alighting.
		for (let k = c; k >= board; k--) {
			if (day.trip[k] !== trip) continue;
			edges.push([day.codes[day.from[k]], day.codes[day.to[k]]]);
		}
		legs.unshift(day.tripName.get(trip) ?? 'Trein');
		firstDeparture = day.dep[board];
		station = day.from[board];
	}
	if (arrival < 0) return null;
	return {
		minutes: Math.round((arrival - firstDeparture) / 60),
		transfers: legs.length - 1,
		departure: firstDeparture,
		edges,
		legs
	};
}

/**
 * Fastest route from `originCode` to each target, over departures in [fromTime, toTime] every
 * `step` seconds. Shortest duration wins; ties go to fewer transfers.
 */
export function fastestRoutes(
	day: Day,
	originCode: string,
	targets: string[],
	{ fromTime = 8 * 3600, toTime = 10 * 3600, step = 15 * 60 } = {}
): Map<string, Route | null> {
	const result = new Map<string, Route | null>(targets.map((t) => [t, null]));
	const origin = day.index.get(originCode);
	if (origin === undefined) return result;
	for (let t = fromTime; t <= toTime; t += step) {
		const { via, boardedAt } = scan(day, origin, t);
		for (const code of targets) {
			if (code === originCode) {
				result.set(code, { minutes: 0, transfers: 0, departure: t, edges: [], legs: [] });
				continue;
			}
			const target = day.index.get(code);
			if (target === undefined) continue;
			const route = reconstruct(day, origin, target, via, boardedAt);
			const best = result.get(code);
			if (
				route &&
				(!best ||
					route.minutes < best.minutes ||
					(route.minutes === best.minutes && route.transfers < best.transfers))
			)
				result.set(code, route);
		}
	}
	return result;
}

// --- Backwards: the trip home ---------------------------------------------------------------------

/**
 * The reverse scan: latest departure from every station that still reaches `target` by `deadline`.
 * Connections are visited by arrival, latest first. Per station we keep the connection to leave by,
 * and per trip the connection where we get off it.
 */
function scanBack(day: Day, target: number, deadline: number) {
	const n = day.codes.length;
	const latest = new Float64Array(n).fill(-Infinity);
	const via = new Int32Array(n).fill(-1);
	const alightAt = new Map<number, number>(); // trip → connection index where we leave it
	latest[target] = deadline;
	const horizon = deadline - 8 * 3600;
	for (const c of day.byArrivalDesc) {
		if (day.arr[c] > deadline) continue;
		if (day.dep[c] < horizon) break;
		const trip = day.trip[c];
		const to = day.to[c];
		if (!alightAt.has(trip)) {
			const slack = to === target ? 0 : TRANSFER_SECONDS;
			if (day.arr[c] + slack > latest[to]) continue;
			alightAt.set(trip, c);
		}
		const from = day.from[c];
		if (day.dep[c] > latest[from]) {
			latest[from] = day.dep[c];
			via[from] = c;
		}
	}
	return { via, alightAt };
}

function reconstructBack(
	day: Day,
	source: number,
	target: number,
	via: Int32Array,
	alightAt: Map<number, number>
): Route | null {
	const edges: [string, string][] = [];
	const legs: string[] = [];
	let station = source;
	let firstDeparture = -1;
	let arrival = -1;
	let guard = 0;
	while (station !== target) {
		const c = via[station];
		if (c < 0 || guard++ > 20) return null;
		const trip = day.trip[c];
		const exit = alightAt.get(trip)!;
		if (firstDeparture < 0) firstDeparture = day.dep[c];
		for (let k = c; k <= exit; k++) {
			if (day.trip[k] !== trip) continue;
			edges.push([day.codes[day.from[k]], day.codes[day.to[k]]]);
		}
		legs.push(day.tripName.get(trip) ?? 'Trein');
		arrival = day.arr[exit];
		station = day.to[exit];
	}
	if (firstDeparture < 0) return null;
	return {
		minutes: Math.round((arrival - firstDeparture) / 60),
		transfers: legs.length - 1,
		departure: firstDeparture,
		edges,
		legs
	};
}

/**
 * Fastest trip from each source back to `homeCode`, arriving home between fromTime and toTime
 * (deadlines every `step`): the afternoon after a walk. Shortest wins; ties go to fewer transfers.
 */
export function fastestRoutesHome(
	day: Day,
	homeCode: string,
	sources: string[],
	{ fromTime = 15 * 3600, toTime = 20 * 3600, step = 15 * 60 } = {}
): Map<string, Route | null> {
	const result = new Map<string, Route | null>(sources.map((s) => [s, null]));
	const home = day.index.get(homeCode);
	if (home === undefined) return result;
	for (let deadline = fromTime; deadline <= toTime; deadline += step) {
		const { via, alightAt } = scanBack(day, home, deadline);
		for (const code of sources) {
			if (code === homeCode) {
				result.set(code, { minutes: 0, transfers: 0, departure: deadline, edges: [], legs: [] });
				continue;
			}
			const source = day.index.get(code);
			if (source === undefined) continue;
			const route = reconstructBack(day, source, home, via, alightAt);
			const best = result.get(code);
			if (
				route &&
				(!best ||
					route.minutes < best.minutes ||
					(route.minutes === best.minutes && route.transfers < best.transfers))
			)
				result.set(code, route);
		}
	}
	return result;
}

// --- Loading days from SQLite, cached per feed and date -------------------------------------------

const cache = new Map<string, Day>();

/** The timetable for one date (YYYY-MM-DD), or null when the feed doesn't cover it. */
export function loadDay(db: DatabaseSync, ymd: string): Day | null {
	const feed = (
		db.prepare(`select value from meta where key = 'gtfs_feed_date'`).get() as
			{ value: string } | undefined
	)?.value;
	if (!feed) return null;
	const key = `${feed}:${ymd}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const rows = db
		.prepare(
			`select st.trip_id, st.code, st.arr, st.dep, t.name
			 from gtfs_service_date d
			 join gtfs_trip t on t.service_id = d.service_id
			 join gtfs_stop_time st on st.trip_id = t.trip_id
			 where d.date = ?
			 order by st.trip_id, st.seq`
		)
		.all(ymd.replaceAll('-', '')) as {
		trip_id: number;
		code: string;
		arr: number;
		dep: number;
		name: string;
	}[];
	if (!rows.length) return null;
	const day = buildDay(rows);
	cache.set(key, day);
	// A handful of days is plenty: the map asks for one at a time.
	while (cache.size > 4) cache.delete(cache.keys().next().value!);
	return day;
}
