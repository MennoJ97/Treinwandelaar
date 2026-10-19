import { db } from '#lib/server/context.js';
import { publicWalks } from '#lib/server/walks.js';
import { walkPath } from '#lib/walk.js';
import type { RequestHandler } from './$types';

const escape = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": 'apos' }[c]};`
	);

/**
 * Every page an anonymous visitor may see: the home page, the index of walks and each walk built from
 * OpenStreetMap (never Wandelnet's, which are for personal use only). A walk's <lastmod> is the day
 * an ingest last changed its data (walks.changed_on); the two pages that only list them go without,
 * as a date there would be a guess.
 */
export const GET: RequestHandler = ({ url }) => {
	const entry = (path: string, lastmod?: string | null) =>
		`<url><loc>${escape(url.origin + path)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
	const xml = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		entry('/'),
		entry('/route/'),
		...publicWalks(db()).map((w) => entry(walkPath(w.id), w.changedOn)),
		'</urlset>',
		''
	].join('\n');
	return new Response(xml, {
		headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'max-age=3600' }
	});
};
