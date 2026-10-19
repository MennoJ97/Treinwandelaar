import { error } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { amsterdamYmd } from '../itinerary';

/** How far ahead the fallback plans. The page asks a week ahead at most when no timetable is loaded. */
export const NS_DAYS_AHEAD = 31;

/**
 * Reachability for a date outside the GTFS timetable costs one NS call per walk station (hundreds),
 * and the whole site gets 300 per five minutes: a single request could use it all up. So only a
 * signed-in user (or the shared local user outside the demo) may start it, from a known station, for
 * a real date from today to NS_DAYS_AHEAD ahead. Throws a 4xx whose message the page shows otherwise.
 */
export function allowNsFallback(
	conn: DatabaseSync,
	from: string,
	date: string,
	user: string | null,
	today = amsterdamYmd()
) {
	if (!user)
		error(403, 'Deze dag valt buiten de dienstregeling; reistijden van de NS-planner na inloggen.');
	const noon = (ymd: string) => Date.parse(`${ymd}T12:00:00Z`);
	const last = new Date(noon(today) + NS_DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10);
	// The format is checked already, but 2026-11-00 passes it and sorts inside the range.
	const real = !Number.isNaN(noon(date)) && new Date(noon(date)).toISOString().startsWith(date);
	if (!real || date < today || date > last)
		error(400, `Reistijden van de NS-planner alleen voor ${today} tot en met ${last}.`);
	if (!conn.prepare('select 1 from stations where code = ?').get(from))
		error(400, `Onbekend station: ${from}`);
}
