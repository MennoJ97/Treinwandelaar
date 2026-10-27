import { error } from '@sveltejs/kit';
import type { Station } from '#lib/types.js';
import { db, homeStation, ns } from '#lib/server/context.js';
import { getWalk, osmUpdated, wandelnetUpdated } from '#lib/server/walks.js';
import type { PageServerLoad } from './$types';

/**
 * One walk on its day, to take along: the map follows you on it, and the trains home are worked out
 * from where you are. The plan (date, trains) and the way round come in the link, as on the home page.
 */
export const load: PageServerLoad = ({ params, locals }) => {
	const conn = db();
	const walk = getWalk(conn, params.id, locals.user);
	if (!walk) error(404, 'Deze wandeling bestaat niet (meer).');
	return {
		walk,
		/** Every station, for the nearest one if you stop early. */
		stations: conn
			.prepare('select code, name, lat, lng from stations order by name')
			.all() as unknown as Pick<Station, 'code' | 'name' | 'lat' | 'lng'>[],
		defaultHome: homeStation(),
		hasNsKey: ns() !== null,
		/** When the route data was last refreshed, for the map's credit line. */
		updated: walk.source === 'osm' ? osmUpdated(conn) : wandelnetUpdated(conn)
	};
};
