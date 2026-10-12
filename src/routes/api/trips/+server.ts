import { error, json } from '@sveltejs/kit';
import { ns } from '#lib/server/context.js';
import { NsApiError } from '#lib/server/ns.js';
import type { RequestHandler } from './$types';

/** Proxy to the NS trip planner so the API key stays server-side. Cached for 5 minutes. */
export const GET: RequestHandler = async ({ url }) => {
	const client = ns();
	if (!client) error(503, 'Geen NS_API_KEY ingesteld: treintijden zijn niet beschikbaar.');
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	const dateTime = url.searchParams.get('dateTime');
	if (!from || !to || !dateTime) error(400, 'from, to and dateTime are required');
	if (from === to) return json([]);
	try {
		const trips = await client.trips({
			from,
			to,
			dateTime,
			searchForArrival: url.searchParams.get('searchForArrival') === 'true'
		});
		return json(trips);
	} catch (err) {
		if (err instanceof NsApiError) error(502, err.message);
		throw err;
	}
};
