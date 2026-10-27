import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/context.js';
import { keepPlannedWalk } from '#lib/server/paths.js';
import { getWalk, updateUserWalk, withStages, type UserWalkUpdate } from '#lib/server/walks.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals }) => {
	const conn = db();
	const walk = getWalk(conn, params.id, locals.user);
	if (!walk) error(404, 'Walk not found');
	return json(withStages(conn, walk, locals.user));
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
	if (body.doneDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.doneDate))
		error(400, 'doneDate must be YYYY-MM-DD');
	// A stretch you planned yourself becomes a walk of its own; the ingest's walks are there already.
	keepPlannedWalk(conn, walk);
	updateUserWalk(conn, locals.user, params.id, body);
	return json(withStages(conn, getWalk(conn, params.id, locals.user)!, locals.user));
};
