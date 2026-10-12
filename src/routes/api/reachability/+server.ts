import { error, json } from '@sveltejs/kit';
import { db, ns } from '#lib/server/context.js';
import { nextSaturdayMorning } from '#lib/itinerary.js';
import type { Reachability } from '#lib/types.js';
import type { RequestHandler } from './$types';

const WEEK_SECONDS = 7 * 24 * 3600;
const CONCURRENCY = 3;

/**
 * Fastest trip from `from` to every walk start/end station at a reference time (next Saturday 09:00).
 * Used to colour the map, so planned times are good enough; cached for a week per station pair.
 * Outbound time to an end station doubles as an estimate of the ride home from it.
 */
export const GET: RequestHandler = async ({ url }) => {
	const client = ns();
	if (!client) error(503, 'Geen NS_API_KEY ingesteld.');
	const from = url.searchParams.get('from');
	if (!from) error(400, 'from is required');

	const codes = (
		db()
			.prepare(
				`select start_station as code from walks where start_station is not null
				 union select end_station from walks where end_station is not null`
			)
			.all() as { code: string }[]
	).map((r) => r.code);

	const dateTime = nextSaturdayMorning();
	const result: Reachability = {};
	const queue = [...codes];
	async function worker() {
		for (let code = queue.shift(); code; code = queue.shift()) {
			if (code === from) {
				result[code] = { minutes: 0, transfers: 0 };
				continue;
			}
			try {
				const trips = await client!.trips({
					from: from!,
					to: code,
					dateTime,
					ttlSeconds: WEEK_SECONDS
				});
				const best = trips.reduce<(typeof trips)[number] | null>(
					(a, t) => (!a || t.plannedDurationMin < a.plannedDurationMin ? t : a),
					null
				);
				result[code] = best
					? { minutes: best.plannedDurationMin, transfers: best.transfers }
					: null;
			} catch (err) {
				console.warn(`reachability ${from} → ${code} failed:`, (err as Error).message);
				result[code] = null;
			}
		}
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	return json(result, { headers: { 'cache-control': 'private, max-age=3600' } });
};
