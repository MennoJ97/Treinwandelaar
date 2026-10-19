import { error } from '@sveltejs/kit';
import { db } from '#lib/server/context.js';
import { sketch } from '#lib/server/sketch.js';
import { getWalk, osmUpdated, relatedWalks, wandelnetUpdated } from '#lib/server/walks.js';
import type { PageServerLoad } from './$types';

/** Plain HTML, no hydration: nothing on the page needs a script, and the data would double its size. */
export const csr = false;

/**
 * A walk's own page, for search engines and links: what an anonymous visitor may see (OpenStreetMap's
 * walks), as plain HTML. The map, the trains and your own notes stay on the home page (?walk=).
 */
export const load: PageServerLoad = ({ params, locals }) => {
	const conn = db();
	// Only stored walks: a stretch planned on request has no page (there are thousands of pairs).
	const walk = getWalk(conn, params.id, locals.user, { planned: false });
	if (!walk) error(404, 'Deze wandeling bestaat niet (meer).');
	const { geometry, ...rest } = walk;
	return {
		walk: rest,
		sketch: sketch(geometry),
		related: relatedWalks(conn, walk, locals.user),
		updated: walk.source === 'osm' ? osmUpdated(conn) : wandelnetUpdated(conn)
	};
};
