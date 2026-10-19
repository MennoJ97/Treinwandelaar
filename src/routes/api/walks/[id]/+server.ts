import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/context.js';
import { keepPlannedWalk } from '#lib/server/paths.js';
import { getWalk, updateUserWalk, type UserWalkUpdate } from '#lib/server/walks.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals }) => {
	const walk = getWalk(db(), params.id, locals.user);
	if (!walk) error(404, 'Walk not found');
	return json(walk);
};

/** Personal layer of the signed-in user: wishlist/done status, own rating (1–5), notes. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Log in om wandelingen bij te houden.');
	const conn = db();
	const walk = getWalk(conn, params.id, locals.user);
	if (!walk) error(404, 'Walk not found');
	const body = (await request.json()) as UserWalkUpdate;
	if (body.status !== undefined && ![null, 'wishlist', 'done'].includes(body.status))
		error(400, 'Invalid status');
	if (
		body.ownRating != null &&
		!(Number.isInteger(body.ownRating) && body.ownRating >= 1 && body.ownRating <= 5)
	)
		error(400, 'Rating must be 1–5');
	// A stretch you planned yourself becomes a walk of its own; the ingest's walks are there already.
	keepPlannedWalk(conn, walk);
	updateUserWalk(conn, locals.user, params.id, body);
	return json(getWalk(conn, params.id, locals.user));
};
