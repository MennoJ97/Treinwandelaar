import type { DatabaseSync } from 'node:sqlite';
import type { WeatherResponse } from '../weather';

/** Past this a stuck updater shows no forecast, instead of an old one as if it were today's. */
export const MAX_AGE_MS = 36 * 3600_000;

/**
 * One day's forecast for every cell, or null when there is none (or only a stale one). Grid numbers
 * only, no walks: which is why this is the same for anonymous visitors and signed-in users.
 */
export function dayForecast(
	db: DatabaseSync,
	date: string,
	now = Date.now()
): WeatherResponse | null {
	const ensemble = db
		.prepare('select cell, fetched_at, masks from weather_ensemble where date = ?')
		.all(date) as unknown as { cell: string; fetched_at: number; masks: Uint8Array }[];
	if (!ensemble.length) return null;
	const fetchedAt = Math.min(...ensemble.map((r) => r.fetched_at));
	if (now - fetchedAt > MAX_AGE_MS) return null;
	const hourly = db
		.prepare('select cell, mm from weather_hourly where date = ? and fetched_at > ?')
		.all(date, now - MAX_AGE_MS) as { cell: string; mm: string }[];
	return {
		date,
		fetchedAt,
		ensemble: Object.fromEntries(
			ensemble.map((r) => [r.cell, Buffer.from(r.masks).toString('base64')])
		),
		hourly: Object.fromEntries(hourly.map((r) => [r.cell, JSON.parse(r.mm) as number[]]))
	};
}
