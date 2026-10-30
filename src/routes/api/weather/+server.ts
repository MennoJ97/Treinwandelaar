import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/context.js';
import { dayForecast } from '#lib/server/weather.js';
import type { RequestHandler } from './$types';

/**
 * The rain forecast for one day, per grid cell; null when there is none. No walk data in it, so it's
 * the same for everyone, and it reads only what scripts/ingest/weather.ts stored: a visitor never
 * causes a call to Open-Meteo.
 */
export const GET: RequestHandler = ({ url }) => {
	const date = url.searchParams.get('date') ?? '';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(400, 'date must be YYYY-MM-DD');
	return json(dayForecast(db(), date), { headers: { 'cache-control': 'public, max-age=600' } });
};
