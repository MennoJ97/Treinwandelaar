import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/context.js';
import { keepPlannedWalk } from '#lib/server/paths.js';
import { deleteSavedTrip, listSavedTrips, saveTrip } from '#lib/server/savedTrips.js';
import { getWalk } from '#lib/server/walks.js';
import { isPlan, type TripPlan } from '#lib/plan.js';
import type { RequestHandler } from './$types';

/** Your saved days out. Each change answers with the whole list, as it now stands. */
export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) error(401, 'Log in om reizen te bewaren.');
	return json(listSavedTrips(db(), locals.user));
};

/** Save a walk's plan for its date: { walkId, reversed, date, time, out, back }. */
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Log in om reizen te bewaren.');
	const body = (await request.json().catch(() => null)) as
		(TripPlan & { walkId?: unknown; reversed?: unknown }) | null;
	if (!isPlan(body) || typeof body.walkId !== 'string') error(400, 'Invalid trip');
	const conn = db();
	const walk = getWalk(conn, body.walkId, locals.user);
	if (!walk) error(404, 'Walk not found');
	// A stretch you planned yourself becomes a walk of its own, as when you mark it.
	keepPlannedWalk(conn, walk);
	saveTrip(conn, locals.user, walk.id, body.reversed === true, body);
	return json(listSavedTrips(conn, locals.user));
};

/** Forget the trip for ?walk= on ?date=. */
export const DELETE: RequestHandler = ({ url, locals }) => {
	if (!locals.user) error(401, 'Log in om reizen te bewaren.');
	const walkId = url.searchParams.get('walk');
	const date = url.searchParams.get('date');
	if (!walkId || !date) error(400, 'walk and date are required');
	const conn = db();
	deleteSavedTrip(conn, locals.user, walkId, date);
	return json(listSavedTrips(conn, locals.user));
};
