import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/context.js';
import { getPath } from '#lib/server/paths.js';
import type { RequestHandler } from './$types';

/** A whole LAW route or streekpad with the stations it passes, to plan your own stretches on. */
export const GET: RequestHandler = ({ params, locals }) => {
	const path = getPath(db(), params.id, locals.user);
	if (!path) error(404, 'Route not found');
	return json(path);
};
