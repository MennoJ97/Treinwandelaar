import { error } from '@sveltejs/kit';
import { db } from '#lib/server/context.js';
import { gpxFilename, walkGpx } from '#lib/server/gpx.js';
import { getWalk } from '#lib/server/walks.js';
import type { RequestHandler } from './$types';

/**
 * A walk's route as a GPX file, for whoever may see the walk: the demo gets only the OSM walks (ODbL,
 * credited in the file), signed-in users also Wandelnet's, for their own use.
 */
export const GET: RequestHandler = ({ params, locals }) => {
	const walk = getWalk(db(), params.id, locals.user);
	if (!walk) error(404, 'Walk not found');
	return new Response(walkGpx(walk), {
		headers: {
			'content-type': 'application/gpx+xml',
			'content-disposition': `attachment; filename="${gpxFilename(walk)}"`
		}
	});
};
