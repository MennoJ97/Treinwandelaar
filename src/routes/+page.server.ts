import { error } from '@sveltejs/kit';
import type { Station } from '#lib/types.js';
import { db, homeStation, ns } from '#lib/server/context.js';
import { timetableLastDay } from '#lib/server/railRouter.js';
import { listPaths } from '#lib/server/paths.js';
import { listSavedTrips } from '#lib/server/savedTrips.js';
import { getWalk, listWalks, osmUpdated, wandelnetUpdated, withStages } from '#lib/server/walks.js';
import { walkPath } from '#lib/walk.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, locals, untrack }) => {
	const conn = db();
	// Only the first render opens ?walk= here. Untracked, so picking another walk in the browser
	// doesn't send every walk with its route again; the page fetches that one walk itself.
	const selectedId = untrack(() => url.searchParams.get('walk'));
	const found = selectedId ? getWalk(conn, selectedId, locals.user) : null;
	const selected = found && withStages(conn, found, locals.user);
	if (selectedId && !selected) error(404, 'Deze wandeling bestaat niet (meer).');
	return {
		/**
		 * The open walk's own page under /route/, for the canonical link: only a stored walk an
		 * anonymous visitor may see has one (not a planned stretch, not Wandelnet's).
		 */
		walkPage:
			selectedId && getWalk(conn, selectedId, null, { planned: false })
				? walkPath(selectedId)
				: null,
		walks: listWalks(conn, locals.user),
		/** LAW routes and streekpaden to plan your own stretches on (their lines come with /api/paths). */
		paths: listPaths(conn, locals.user),
		selected,
		stations: conn.prepare('select * from stations order by name').all() as unknown as Station[],
		defaultHome: homeStation(),
		hasNsKey: ns() !== null,
		/** How far ahead you can pick a travel day: as far as the rail timetable reaches. */
		lastDay: timetableLastDay(conn),
		/** Your saved days out (none for the anonymous demo). */
		savedTrips: locals.user ? listSavedTrips(conn, locals.user) : [],
		/** Anonymous visitor of the public demo: OpenStreetMap walks only, nothing saved. */
		demo: locals.user === null,
		wandelnetUpdated: wandelnetUpdated(conn),
		osmUpdated: osmUpdated(conn)
	};
};
