import text from './robots.txt?raw';
import type { RequestHandler } from './$types';

/** robots.txt as written, plus the sitemap, which robots.txt must name by its full URL. */
export const GET: RequestHandler = ({ url }) =>
	new Response(`${text.trimEnd()}\n\nSitemap: ${url.origin}/sitemap.xml\n`, {
		headers: { 'content-type': 'text/plain; charset=utf-8' }
	});
