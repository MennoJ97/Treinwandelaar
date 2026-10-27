/**
 * A day out as the walk's planner has it: the date, when you'd leave, and the trains you picked out
 * and back (by their departure, HH:MM; null for the first that fits). In the link as
 * `?date=2026-10-31&time=0915&out=0921&back=1642`, so a reload, a bookmark or a saved trip opens
 * the same plan.
 */
export interface TripPlan {
	date: string;
	time: string;
	out: string | null;
	back: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3])([0-5]\d)$/;

/** "0915" → "09:15"; anything else → null. */
function clock(value: string | null): string | null {
	const m = value?.match(HHMM);
	return m ? `${m[1]}:${m[2]}` : null;
}

const compact = (time: string) => time.replace(':', '');

/** The plan in a link, if it has one: a date and a time at least. */
export function readPlan(params: { get(key: string): string | null }): TripPlan | null {
	const date = params.get('date');
	const time = clock(params.get('time'));
	if (!date || !DATE.test(date) || !time) return null;
	return { date, time, out: clock(params.get('out')), back: clock(params.get('back')) };
}

export function writePlan(params: URLSearchParams, plan: TripPlan | null) {
	for (const key of PLAN_KEYS) params.delete(key);
	if (!plan) return;
	params.set('date', plan.date);
	params.set('time', compact(plan.time));
	if (plan.out) params.set('out', compact(plan.out));
	if (plan.back) params.set('back', compact(plan.back));
}

/** Just the trains: they belong to one walk, one way round. */
export function dropTrains(params: URLSearchParams) {
	params.delete('out');
	params.delete('back');
}

export const PLAN_KEYS = ['date', 'time', 'out', 'back'] as const;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A plan as a request body may hold it: a real date and HH:MM clocks, the trains optional. */
export function isPlan(value: unknown): value is TripPlan {
	const p = value as Partial<TripPlan> | null;
	const clockOrNull = (c: unknown) => c == null || (typeof c === 'string' && CLOCK.test(c));
	return (
		typeof p?.date === 'string' &&
		DATE.test(p.date) &&
		typeof p.time === 'string' &&
		CLOCK.test(p.time) &&
		clockOrNull(p.out) &&
		clockOrNull(p.back)
	);
}
