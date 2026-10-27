import { AT_STATION_M, WALKABLE_STATION_M } from './types.js';

export interface WalkPace {
	/** Walking speed on flat Dutch terrain, km/h. */
	speedKmh: number;
	/** Minutes of breaks per full 10 km walked (coffee, lunch, looking around). */
	breakMinPer10Km: number;
}

export const DEFAULT_PACE: WalkPace = { speedKmh: 4.5, breakMinPer10Km: 20 };

/** Break time for a walk: proportional to distance, rounded to 5 minutes (nobody pauses for 7). */
export function breakMinutes(distanceKm: number, pace: WalkPace = DEFAULT_PACE): number {
	return Math.round(((distanceKm / 10) * pace.breakMinPer10Km) / 5) * 5;
}

export function walkMinutes(distanceKm: number, pace: WalkPace = DEFAULT_PACE): number {
	const moving = (distanceKm / pace.speedKmh) * 60;
	return Math.round(moving) + breakMinutes(distanceKm, pace);
}

/**
 * Rough door-to-door estimate for a bus/taxi leg between a station and a route end that is too far
 * to walk: ~10 min waiting plus ~3 min per km, rounded up to 5 minutes. Deliberately conservative.
 */
export function busMinutes(metres: number): number {
	return Math.ceil((10 + (metres / 1000) * 3) / 5) * 5;
}

/** Streets wind: the walk between a station or stop and the route is about this much longer than the straight line. */
const DETOUR = 1.3;

/** Kilometres on foot between a station (or stop) and the route, from the straight-line metres. */
export const accessKm = (metres: number) => (metres * DETOUR) / 1000;

/** Minutes on foot between a station (or stop) and the route, rounded up. */
export function accessMinutes(metres: number, speedKmh = DEFAULT_PACE.speedKmh): number {
	return Math.ceil((accessKm(metres) / speedKmh) * 60);
}

/** Between a station and a route end: nothing (it's at the station), a walk, or a bus. */
export type Access = 'station' | 'walk' | 'bus';
export const accessAt = (metres: number | null): Access =>
	metres == null || metres <= AT_STATION_M
		? 'station'
		: metres <= WALKABLE_STATION_M
			? 'walk'
			: 'bus';

/** Getting off a train and finding the bus, or the other way round. */
export const TRANSFER_MIN = 5;

export function addMinutes(iso: string, minutes: number): string {
	return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export function minutesBetween(fromIso: string, toIso: string): number {
	return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000);
}

export function formatDuration(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return h ? `${h}u${m.toString().padStart(2, '0')}` : `${m} min`;
}

/** HH:MM in Dutch local time, regardless of where the server or browser runs. */
export function formatTime(iso: string): string {
	return new Date(iso).toLocaleTimeString('nl-NL', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/Amsterdam'
	});
}

/** RFC3339 timestamp for a wall-clock time in Amsterdam, with the correct CET/CEST offset. */
export function amsterdamIso(ymd: string, hm: string): string {
	const probe = new Date(`${ymd}T12:00:00Z`);
	const label = probe.toLocaleString('en-US', {
		timeZone: 'Europe/Amsterdam',
		timeZoneName: 'longOffset'
	});
	const offset = label.match(/GMT([+-]\d{2}:\d{2})/)?.[1] ?? '+00:00';
	return `${ymd}T${hm}:00${offset}`;
}

export function amsterdamYmd(date = new Date()): string {
	return date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
}

/** Reference departure for the reachability map: the next Saturday 09:00 Amsterdam time. */
export function nextSaturdayMorning(now = new Date()): string {
	const d = new Date(now);
	const daysUntilSat = (6 - d.getDay() + 7) % 7 || 7;
	d.setDate(d.getDate() + daysUntilSat);
	return amsterdamIso(amsterdamYmd(d), '09:00');
}

export type TravelBand = 'near' | 'medium' | 'far' | 'veryfar' | 'unknown';

export function travelBand(minutes: number | null | undefined): TravelBand {
	if (minutes == null) return 'unknown';
	if (minutes < 30) return 'near';
	if (minutes < 60) return 'medium';
	if (minutes < 90) return 'far';
	return 'veryfar';
}
