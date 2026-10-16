import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/context.js';
import { feederRides } from '#lib/server/feeders.js';
import { getWalk } from '#lib/server/walks.js';
import type { RequestHandler } from './$types';

/** Buses between the station and a route end too far to walk, on `date` (YYYY-MM-DD). */
export const GET: RequestHandler = ({ params, url, locals }) => {
	const date = url.searchParams.get('date') ?? '';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(400, 'date (YYYY-MM-DD) is required');
	const conn = db();
	if (!getWalk(conn, params.id, locals.user)) error(404, 'Walk not found');
	return json(feederRides(conn, params.id, date));
};
