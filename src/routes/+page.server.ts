import { error } from '@sveltejs/kit';
import type { Station } from '#lib/types.js';
import { db, homeStation, ns } from '#lib/server/context.js';
import { getWalk, listWalks, osmUpdated, wandelnetUpdated } from '#lib/server/walks.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, locals }) => {
	const conn = db();
	const selectedId = url.searchParams.get('walk');
	const selected = selectedId ? getWalk(conn, selectedId, locals.user) : null;
	if (selectedId && !selected) error(404, 'Deze wandeling bestaat niet (meer).');
	return {
		walks: listWalks(conn, locals.user),
		selected,
		stations: conn.prepare('select * from stations order by name').all() as unknown as Station[],
		defaultHome: homeStation(),
		hasNsKey: ns() !== null,
		/** Anonymous visitor of the public demo: OpenStreetMap walks only, nothing saved. */
		demo: locals.user === null,
		wandelnetUpdated: wandelnetUpdated(conn),
		osmUpdated: osmUpdated(conn)
	};
};
