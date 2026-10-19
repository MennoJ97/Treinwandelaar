import { json } from '@sveltejs/kit';
import { db } from '#lib/server/context.js';
import { pathOverview } from '#lib/server/paths.js';
import type { RequestHandler } from './$types';

/**
 * The whole LAW routes and streekpaden you may see, simplified, for the faint lines under the walks
 * on the map. Changes only with the weekly ingest; per viewer, since the demo sees fewer.
 */
export const GET: RequestHandler = ({ locals }) =>
	json(pathOverview(db(), locals.user), {
		headers: { 'cache-control': 'private, max-age=3600' }
	});
