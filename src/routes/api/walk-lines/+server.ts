import { db } from '#lib/server/context.js';
import { walkLines } from '#lib/server/walks.js';
import type { RequestHandler } from './$types';

/**
 * The route lines of the walks on the home page, id → [[lng, lat], ...]. Apart from the page data, so
 * the page's HTML (which inlines its data) stays far below what a search engine reads of it.
 */
export const GET: RequestHandler = ({ locals }) =>
	new Response(walkLines(db(), locals.user), {
		headers: { 'content-type': 'application/json' }
	});
