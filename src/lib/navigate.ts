import { haversine, locateOnLine, type LngLat } from './geo.js';
import { accessKm } from './itinerary.js';

/**
 * Following yourself along one walk on its day: where you are on the line, whether you've wandered
 * off it or turned back, and how fast you actually go. Pure, so the day page feeds it fixes and a
 * test can too.
 */

/** A fix from the phone, as far as following needs it. */
export interface Fix {
	lng: number;
	lat: number;
	/** Metres either way the phone is unsure about. */
	accuracyM: number;
	/** ms since 1970. */
	time: number;
}

export interface Progress {
	/** You've been on the line at least once: before that you're on your way to it. */
	started: boolean;
	/** Metres along the line at the last fix that was on it. */
	alongM: number;
	lengthM: number;
	/** How far off the line the last fix was. */
	offM: number;
	/** Off the line long enough to say so (not one stray fix). */
	offRoute: boolean;
	/** Since when the fixes have been off the line; null while on it. */
	offSince: number | null;
	/** Going back along the line for a while. */
	wrongWay: boolean;
	/** The fixes on the line, oldest first: time and metres along, for the pace and the direction. */
	trail: { time: number; alongM: number }[];
}

/** On the line: within this, plus what the phone is unsure about (up to `MAX_SLACK_M`). */
export const ON_LINE_M = 40;
const MAX_SLACK_M = 50;
/** Off the line for this long before it counts: a fix in a wood can be well out for a moment. */
const OFF_FOR_MS = 20_000;
/** Back along the line by this much, compared with the furthest of the last few minutes. */
const BACK_M = 80;
const BACK_WINDOW_MS = 4 * 60_000;
/** How much trail to keep: enough for the pace. */
const TRAIL_MS = 90 * 60_000;
const TRAIL_STEP_MS = 10_000;

export function startProgress(line: LngLat[]): Progress {
	const { lengthM } = locateOnLine(line[0], line);
	return {
		started: false,
		alongM: 0,
		lengthM,
		offM: 0,
		offRoute: false,
		offSince: null,
		wrongWay: false,
		trail: []
	};
}

/** Progress after one more fix. */
export function step(progress: Progress, fix: Fix, line: LngLat[]): Progress {
	const spot = locateOnLine([fix.lng, fix.lat], line, progress.alongM);
	const onLine = spot.offM <= ON_LINE_M + Math.min(fix.accuracyM, MAX_SLACK_M);
	if (!onLine) {
		const offSince = progress.offSince ?? fix.time;
		return {
			...progress,
			offM: spot.offM,
			offSince,
			// Before you've reached the line you're not off it, just not there yet.
			offRoute: progress.started && fix.time - offSince >= OFF_FOR_MS
		};
	}
	// About one point per TRAIL_STEP_MS: a phone gives a fix a second, and the trail is kept.
	const prev = progress.trail.at(-2);
	const kept =
		prev && fix.time - prev.time < TRAIL_STEP_MS ? progress.trail.slice(0, -1) : progress.trail;
	const trail = [...kept, { time: fix.time, alongM: spot.alongM }].filter(
		(t) => fix.time - t.time <= TRAIL_MS
	);
	// Turned back: well short of the furthest you got in the last few minutes. Forward again (or
	// standing still at a viewpoint) and it's gone.
	const recent = trail.filter((t) => fix.time - t.time <= BACK_WINDOW_MS);
	const furthest = Math.max(...recent.map((t) => t.alongM));
	return {
		started: true,
		alongM: spot.alongM,
		lengthM: spot.lengthM,
		offM: spot.offM,
		offRoute: false,
		offSince: null,
		wrongWay: furthest - spot.alongM >= BACK_M,
		trail
	};
}

/** Enough walking to say something about your pace: not the first stroll from the station. */
const PACE_MIN_MS = 10 * 60_000;
const PACE_MIN_M = 500;
/** Your pace over about the last this long: breaks in it count, as they will ahead. */
const PACE_WINDOW_MS = 45 * 60_000;

/** Your speed along the line in km/h, breaks included; null until there's enough of it. */
export function paceKmh(progress: Progress): number | null {
	const last = progress.trail.at(-1);
	if (!last) return null;
	const from =
		progress.trail.find((t) => last.time - t.time <= PACE_WINDOW_MS) ?? progress.trail[0];
	const ms = last.time - from.time;
	const metres = last.alongM - from.alongM;
	if (ms < PACE_MIN_MS || metres < PACE_MIN_M) return null;
	return metres / 1000 / (ms / 3_600_000);
}

/** The spot `alongM` metres along the line. */
export function pointAlong(line: LngLat[], alongM: number): LngLat {
	let walked = 0;
	for (let i = 1; i < line.length; i++) {
		const segM = haversine(line[i - 1], line[i]);
		if (walked + segM >= alongM && segM > 0) {
			const t = (alongM - walked) / segM;
			const [a, b] = [line[i - 1], line[i]];
			return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
		}
		walked += segM;
	}
	return line.at(-1)!;
}

/** The line split at `alongM`: the part behind you and the part ahead, both through that spot. */
export function splitLine(line: LngLat[], alongM: number): [LngLat[], LngLat[]] {
	const at = pointAlong(line, alongM);
	let walked = 0;
	for (let i = 1; i < line.length; i++) {
		walked += haversine(line[i - 1], line[i]);
		if (walked >= alongM)
			return [
				[...line.slice(0, i), at],
				[at, ...line.slice(i)]
			];
	}
	return [line, [line.at(-1)!]];
}

/** Compass bearing from `a` to `b`, degrees clockwise from north. */
export function bearing(a: LngLat, b: LngLat): number {
	const toRad = (d: number) => (d * Math.PI) / 180;
	const [lng1, lat1, lng2, lat2] = [toRad(a[0]), toRad(a[1]), toRad(b[0]), toRad(b[1])];
	const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
	const x =
		Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** "noord", "zuidwest"…: the way to go, in words. */
export function compassWord(degrees: number): string {
	const words = ['noord', 'noordoost', 'oost', 'zuidoost', 'zuid', 'zuidwest', 'west', 'noordwest'];
	return words[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

/** The stations closest to you as the crow flies, nearest first, with the walk there in km. */
export function closestStations<T extends { lat: number; lng: number }>(
	here: LngLat,
	stations: T[],
	count: number
): { station: T; metres: number; walkKm: number }[] {
	return stations
		.map((station) => ({ station, metres: haversine(here, [station.lng, station.lat]) }))
		.sort((a, b) => a.metres - b.metres)
		.slice(0, count)
		.map((s) => ({ ...s, walkKm: accessKm(s.metres) }));
}
