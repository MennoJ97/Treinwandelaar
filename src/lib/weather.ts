/**
 * The chance of staying dry on a walk, from forecast scenarios (scripts/ingest/weather.ts).
 *
 * The ensemble's scenarios are kept apart instead of as a chance per hour and cell: wet hours come
 * in runs, and scenario 12 is the same weather in every cell, so counting the scenarios that stay
 * dry for the whole walk needs no assumption about how the hours or cells depend on each other.
 * Multiplying hourly chances does, and on a day of passing drizzle it said 17% where the scenarios
 * said 47%.
 *
 * Scored in the browser, since the walking hours depend on your home station and pace.
 */
import { haversine, type LngLat } from './geo';

/** The hours of the day a forecast holds: bit 0 of a mask is 06:00–07:00, bit 16 22:00–23:00. */
export const FIRST_HOUR = 6;
export const LAST_HOUR = 22;
export const HOURS = LAST_HOUR - FIRST_HOUR + 1;

/** Rain from here on counts as wet: below it a trace of drizzle makes any day look like a coin flip. */
export const WET_MM = 0.3;

/** The ensemble's grid, so a cell is one of its points, and the finer one of the hourly forecast. */
export const ENSEMBLE_STEP = 0.25;
export const HOURLY_STEP = 0.1;

/** A forecast covers today and this many days after it. */
export const ENSEMBLE_DAYS_AHEAD = 7;
export const HOURLY_DAYS_AHEAD = 2;

/** The grid point nearest to a place, as "lat,lng". */
export function cellKey([lng, lat]: LngLat, step: number): string {
	const snap = (v: number) => (Math.round(v / step) * step).toFixed(2);
	return `${snap(lat)},${snap(lng)}`;
}

/** What /api/weather answers for one day. */
export interface WeatherResponse {
	date: string;
	/** When the scenarios were downloaded, in ms. */
	fetchedAt: number;
	/** Per cell, base64 of a little-endian uint32 per scenario: its wet hours as a mask. */
	ensemble: Record<string, string>;
	/** Per cell, mm per hour from FIRST_HOUR; empty beyond HOURLY_DAYS_AHEAD. */
	hourly: Record<string, number[]>;
}

export interface DayForecast {
	date: string;
	masks: Map<string, Uint32Array>;
	hourly: Record<string, number[]>;
}

export function encodeMasks(masks: Uint32Array): Uint8Array {
	const bytes = new Uint8Array(masks.length * 4);
	const view = new DataView(bytes.buffer);
	masks.forEach((m, i) => view.setUint32(i * 4, m, true));
	return bytes;
}

export function decodeMasks(base64: string): Uint32Array {
	const text = atob(base64);
	const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
	const view = new DataView(bytes.buffer);
	return Uint32Array.from({ length: bytes.length >> 2 }, (_, i) => view.getUint32(i * 4, true));
}

export function toForecast(r: WeatherResponse): DayForecast {
	return {
		date: r.date,
		masks: new Map(Object.entries(r.ensemble).map(([cell, b]) => [cell, decodeMasks(b)])),
		hourly: r.hourly
	};
}

/** Minutes since midnight in Amsterdam. */
export function amsterdamMinutes(date: Date): number {
	const [h, m] = date
		.toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Europe/Amsterdam'
		})
		.split(':')
		.map(Number);
	return h * 60 + m;
}

/** One forecast hour of a walk, and how far along the walk you are halfway through it (0–1). */
export interface WalkHour {
	hour: number;
	along: number;
}

/** The forecast hours a walk overlaps, or null when part of it falls outside the forecast's day. */
export function walkHours(startMinutes: number, minutes: number): WalkHour[] | null {
	const end = startMinutes + minutes;
	if (minutes <= 0 || startMinutes < FIRST_HOUR * 60 || end > (LAST_HOUR + 1) * 60) return null;
	const hours: WalkHour[] = [];
	for (let hour = Math.floor(startMinutes / 60); hour * 60 < end; hour++) {
		const from = Math.max(hour * 60, startMinutes);
		const to = Math.min((hour + 1) * 60, end);
		hours.push({ hour, along: ((from + to) / 2 - startMinutes) / minutes });
	}
	return hours;
}

/** The points at these fractions of a line (ascending), assuming a steady pace along it. */
export function pointsAlong(line: LngLat[], fractions: number[]): LngLat[] {
	let total = 0;
	const lengths = line.slice(1).map((p, i) => {
		const m = haversine(line[i], p);
		total += m;
		return m;
	});
	const points: LngLat[] = [];
	let segment = 0;
	let before = 0;
	for (const fraction of fractions) {
		const at = fraction * total;
		while (segment < lengths.length - 1 && before + lengths[segment] < at) {
			before += lengths[segment];
			segment++;
		}
		const part = lengths[segment] ? Math.min(1, (at - before) / lengths[segment]) : 0;
		const [a, b] = [line[segment], line[segment + 1] ?? line[segment]];
		points.push([a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part]);
	}
	return points;
}

/**
 * The share of scenarios (0–1) that stay dry for all of a walk, starting at `startMinutes` past
 * midnight. Null when it can't be told: no line yet, outside the forecast's hours, or a cell the
 * last download didn't have.
 */
export function dryChance(
	line: LngLat[],
	startMinutes: number,
	minutes: number,
	forecast: DayForecast
): number | null {
	if (line.length < 2) return null;
	const hours = walkHours(startMinutes, minutes);
	if (!hours) return null;
	const points = pointsAlong(
		line,
		hours.map((h) => h.along)
	);
	const lookups: { masks: Uint32Array; bit: number }[] = [];
	for (let i = 0; i < hours.length; i++) {
		const masks = forecast.masks.get(cellKey(points[i], ENSEMBLE_STEP));
		if (!masks) return null;
		lookups.push({ masks, bit: 1 << (hours[i].hour - FIRST_HOUR) });
	}
	const scenarios = lookups[0].masks.length;
	if (!scenarios) return null;
	let dry = 0;
	for (let s = 0; s < scenarios; s++) if (!lookups.some((l) => l.masks[s] & l.bit)) dry++;
	return dry / scenarios;
}

/** One hour of the walk in the hourly forecast. */
export interface RainHour {
	hour: number;
	mm: number;
}

/** The hourly forecast along a walk, or null when there is none for this day or one of its cells. */
export function rainAlong(
	line: LngLat[],
	startMinutes: number,
	minutes: number,
	forecast: DayForecast
): RainHour[] | null {
	if (line.length < 2) return null;
	const hours = walkHours(startMinutes, minutes);
	if (!hours) return null;
	const points = pointsAlong(
		line,
		hours.map((h) => h.along)
	);
	const rain: RainHour[] = [];
	for (let i = 0; i < hours.length; i++) {
		const mm = forecast.hourly[cellKey(points[i], HOURLY_STEP)]?.[hours[i].hour - FIRST_HOUR];
		if (mm == null) return null;
		rain.push({ hour: hours[i].hour, mm });
	}
	return rain;
}

/** "85% droog": in steps of 5, since a few scenarios more or less are not news. */
export const dryLabel = (chance: number) => `${Math.round(chance * 20) * 5}% droog`;

/**
 * For sorting, in steps of 10%: without them a 2% difference between two forecast runs could put a
 * two-hour trip above a 40-minute one.
 */
export const dryBand = (chance: number | null | undefined) =>
	chance == null ? -1 : Math.round(chance * 10);
