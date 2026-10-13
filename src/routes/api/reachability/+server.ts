import { error, json } from '@sveltejs/kit';
import { db, ns } from '#lib/server/context.js';
import { NsApiError, type NsClient } from '#lib/server/ns.js';
import { fastestRoutes, loadDay } from '#lib/server/railRouter.js';
import {
	activeOn,
	affectedStretches,
	affectsRoute,
	mapDisruption,
	relevant,
	type DisruptionWithSections
} from '#lib/server/disruptions.js';
import { amsterdamIso, nextSaturdayMorning } from '#lib/itinerary.js';
import type { Reachability, ReachabilityResponse } from '#lib/types.js';
import type { RequestHandler } from './$types';

/**
 * Fastest trip from `from` to every walk start and end station on `date` (default next Saturday),
 * departing 08:00–10:00, plus the disruptions and engineering works on each of those routes.
 *
 * Travel times come from the GTFS timetable (offline, a few ms) when it covers the date; the
 * planned works it already contains (replacement buses, diversions) are in those times. Only for
 * dates outside the timetable do we fall back to asking NS per station (rate-limited, slow).
 */
export const GET: RequestHandler = async ({ url }) => {
	const from = url.searchParams.get('from');
	if (!from) error(400, 'from is required');
	const date = url.searchParams.get('date') ?? nextSaturdayMorning().slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(400, 'date must be YYYY-MM-DD');

	const conn = db();
	const codes = (
		conn
			.prepare(
				`select start_station as code from walks where start_station is not null
				 union select end_station from walks where end_station is not null`
			)
			.all() as { code: string }[]
	).map((r) => r.code);

	const client = ns();
	const day = loadDay(conn, date);
	const response: ReachabilityResponse = day
		? { date, source: 'timetable', times: {}, disruptions: {}, incomplete: false }
		: await fromNs(client, from, codes, date);

	if (day) {
		const disruptions = (client ? await disruptionsOn(client, date) : []).map((d) => ({
			...d,
			stretches: affectedStretches(d, date)
		}));
		for (const [code, route] of fastestRoutes(day, from, codes)) {
			if (!route) {
				response.times[code] = null;
				continue;
			}
			const hits = disruptions.filter((d) => affectsRoute(d.stretches, route.edges));
			response.times[code] = {
				minutes: route.minutes,
				transfers: route.transfers,
				...(hits.length && { disruptions: hits.map((d) => d.id) })
			};
			for (const d of hits) response.disruptions[d.id] = publicPart(d);
		}
		// A station the timetable can't reach that day may be closed by works: say why if we can.
		for (const code of codes) {
			if (response.times[code] !== null) continue;
			const closing = disruptions.filter((d) => d.stretches.some((s) => s.has(code)));
			if (!closing.length) continue;
			for (const d of closing) response.disruptions[d.id] = publicPart(d);
			response.closed ??= {};
			response.closed[code] = closing.map((d) => d.id);
		}
	}

	return json(response, { headers: { 'cache-control': 'no-store' } });
};

/** What the page needs; the station lists and spans stay on the server. */
const publicPart = ({ id, type, title, period, situation, advices }: DisruptionWithSections) => ({
	id,
	type,
	title,
	period,
	situation,
	advices
});

async function disruptionsOn(client: NsClient, date: string): Promise<DisruptionWithSections[]> {
	try {
		return (await client.disruptions())
			.map(mapDisruption)
			.filter((d): d is DisruptionWithSections => !!d && relevant(d) && activeOn(d, date));
	} catch (err) {
		console.warn('disruptions unavailable:', (err as Error).message);
		return [];
	}
}

// --- Fallback for dates outside the timetable: one NS trip query per station --------------------

const WEEK_SECONDS = 7 * 24 * 3600;
const CONCURRENCY = 6;

async function fromNs(
	client: NsClient | null,
	from: string,
	codes: string[],
	date: string
): Promise<ReachabilityResponse> {
	if (!client) error(503, 'Geen dienstregeling voor deze datum en geen NS_API_KEY.');
	const times: Reachability = {};
	const dateTime = amsterdamIso(date, '09:00');
	const queue = [...codes];
	let rateLimited = false;
	async function worker() {
		for (let code = queue.shift(); code; code = queue.shift()) {
			if (code === from) {
				times[code] = { minutes: 0, transfers: 0 };
				continue;
			}
			try {
				const trips = await client!.trips({ from, to: code, dateTime, ttlSeconds: WEEK_SECONDS });
				const best = trips.reduce<(typeof trips)[number] | null>(
					(a, t) => (!a || t.plannedDurationMin < a.plannedDurationMin ? t : a),
					null
				);
				times[code] = best ? { minutes: best.plannedDurationMin, transfers: best.transfers } : null;
			} catch (err) {
				if (err instanceof NsApiError && err.status === 429) {
					rateLimited = true;
					queue.length = 0; // stop the other workers too
					return;
				}
				times[code] = null;
			}
		}
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	return { date, source: 'ns', times, disruptions: {}, incomplete: rateLimited };
}
