import { db } from '#lib/server/context.js';
import { listWalks } from '#lib/server/walks.js';
import type { PageServerLoad } from './$types';

/** Plain HTML, no hydration: nothing on the page needs a script, and the data would double its size. */
export const csr = false;

/** '/route/', not '/route': only paths under /route/ get past Authentik without a login. */
export const trailingSlash = 'always';

/** Every walk on one page, by kind: a way in to each walk's page that needs no map or script. */
export const load: PageServerLoad = ({ locals }) => ({
	walks: listWalks(db(), locals.user).map(
		({
			id,
			name,
			collection,
			isLoop,
			distanceKm,
			startStationName,
			endStationName,
			startPlace,
			endPlace
		}) => ({
			id,
			name,
			collection,
			isLoop,
			distanceKm,
			startStationName,
			endStationName,
			startPlace,
			endPlace
		})
	)
});
