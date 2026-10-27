import { DEFAULT_PACE, type WalkPace } from './itinerary.js';
import type { TripLeg, TripOption } from './types.js';

/**
 * In the browser: trains from the server, kept for when the signal goes, and what this browser
 * remembers about you (your home station and your pace). Shared by the walk's planner and the day
 * page.
 */

/**
 * Trains from `from` to `to` around `dateTime`. Out walking the signal comes and goes: each answer
 * is kept in this browser, and when the server can't be reached the last one comes back instead,
 * with `savedAt` saying from when.
 */
export async function fetchTrips(
	from: string,
	to: string,
	dateTime: string,
	signal?: AbortSignal
): Promise<{ trips: TripOption[]; savedAt: number | null }> {
	const params = new URLSearchParams({ from, to, dateTime });
	const key = params.toString();
	let res: Response;
	try {
		res = await fetch(`/api/trips?${params}`, { signal });
	} catch (err) {
		const kept = signal?.aborted ? null : keptTrains(key);
		if (kept) return { trips: kept.trips, savedAt: kept.at };
		throw err;
	}
	if (!res.ok)
		throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
	const trips = (await res.json()) as TripOption[];
	keepTrains(key, trips);
	return { trips, savedAt: null };
}

/** The last few train lists, newest first, by request. */
const TRAINS_KEY = 'treinwandelaar.trains';
const KEEP_TRAINS = 6;
type Kept = { key: string; at: number; trips: TripOption[] };
function readKept(): Kept[] {
	try {
		return JSON.parse(localStorage.getItem(TRAINS_KEY) ?? '[]');
	} catch {
		return [];
	}
}
function keepTrains(key: string, trips: TripOption[]) {
	const kept = [{ key, at: Date.now(), trips }, ...readKept().filter((k) => k.key !== key)];
	try {
		localStorage.setItem(TRAINS_KEY, JSON.stringify(kept.slice(0, KEEP_TRAINS)));
	} catch {
		/* no storage (private mode, or full): just not kept */
	}
}
const keptTrains = (key: string) => readKept().find((k) => k.key === key) ?? null;

/** One trip per departure: NS can offer two ways from the same train, and the faster one wins. */
export function onePerDeparture(trips: TripOption[]): TripOption[] {
	const best = new Map<string, TripOption>();
	for (const t of trips) {
		const seen = best.get(t.departure);
		if (!seen || t.arrival < seen.arrival) best.set(t.departure, t);
	}
	return [...best.values()];
}

/** Minutes a leg leaves later than planned; 0 when on time (or when NS doesn't say). */
export const delayMinutes = (leg: TripLeg) =>
	Math.max(
		0,
		Math.round(
			(new Date(leg.departure).getTime() - new Date(leg.plannedDeparture).getTime()) / 60_000
		)
	);

/** Your home station, as the list's picker last set it. */
export const HOME_KEY = 'treinwandelaar.home';
export function readHome(fallback: string): string {
	try {
		return localStorage.getItem(HOME_KEY) || fallback;
	} catch {
		return fallback;
	}
}

/** Your walking speed and breaks, as the planner's sliders last set them. */
export const PACE_KEY = 'treinwandelaar.pace';
export function readPace(): WalkPace {
	try {
		const saved = JSON.parse(localStorage.getItem(PACE_KEY) ?? 'null');
		if (typeof saved?.speedKmh === 'number' && typeof saved?.breakMinPer10Km === 'number')
			return { speedKmh: saved.speedKmh, breakMinPer10Km: saved.breakMinPer10Km };
	} catch {
		/* no storage (private mode): the defaults */
	}
	return DEFAULT_PACE;
}
