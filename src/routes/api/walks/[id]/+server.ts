import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/context.js';
import { getWalk, updateUserWalk, type UserWalkUpdate } from '#lib/server/walks.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const walk = getWalk(db(), params.id);
	if (!walk) error(404, 'Walk not found');
	return json(walk);
};

/** Personal layer: wishlist/done status, own rating (1–5), notes. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const conn = db();
	if (!getWalk(conn, params.id)) error(404, 'Walk not found');
	const body = (await request.json()) as UserWalkUpdate;
	if (body.status !== undefined && ![null, 'wishlist', 'done'].includes(body.status))
		error(400, 'Invalid status');
	if (
		body.ownRating != null &&
		!(Number.isInteger(body.ownRating) && body.ownRating >= 1 && body.ownRating <= 5)
	)
		error(400, 'Rating must be 1–5');
	updateUserWalk(conn, params.id, body);
	return json(getWalk(conn, params.id));
};
