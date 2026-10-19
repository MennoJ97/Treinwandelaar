import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DATABASE_PATH } from '$app/env/private';
import { db } from '#lib/server/context.js';
import { walkCard } from '#lib/server/walks.js';
import type { RequestHandler } from './$types';

/**
 * A walk's link-preview card, drawn by the OSM ingest (scripts/lib/cards.ts) into data/og/. Only
 * OpenStreetMap's walks have one, so this answers the same to everyone. Under /route/, which gets
 * past Authentik without a login, so link previews can fetch it.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const card = walkCard(db(), params.id);
	if (!card) error(404, 'Geen kaartje voor deze wandeling');
	const file = join(dirname(DATABASE_PATH), 'og', `${params.id.replaceAll(':', '_')}.png`);
	const png = await readFile(file).catch(() => null);
	if (!png) error(404, 'Geen kaartje voor deze wandeling');
	// The page links ?v=<version>: that URL never changes content, any other may.
	const immutable = url.searchParams.get('v') === card;
	return new Response(new Uint8Array(png), {
		headers: {
			'content-type': 'image/png',
			'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'
		}
	});
};
