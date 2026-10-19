import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSchema } from './db';
import { allowNsFallback } from './nsFallback';

const conn = new DatabaseSync(':memory:');
initSchema(conn);
conn
	.prepare(`insert into stations (code, name, lat, lng) values ('UT', 'Utrecht Centraal', 52, 5)`)
	.run();

/** The HTTP status allowNsFallback refuses with, or null when it lets the request through. */
function refusal(from: string, date: string, user: string | null) {
	try {
		allowNsFallback(conn, from, date, user, '2026-10-19');
		return null;
	} catch (err) {
		return (err as { status: number }).status;
	}
}

describe('NS fallback for days outside the timetable', () => {
	it('is for signed-in users only', () => {
		expect(refusal('UT', '2026-10-25', null)).toBe(403);
		expect(refusal('UT', '2026-10-25', 'menno')).toBeNull();
	});

	it('plans from today up to a month ahead', () => {
		expect(refusal('UT', '2026-10-19', 'menno')).toBeNull();
		expect(refusal('UT', '2026-11-19', 'menno')).toBeNull();
		expect(refusal('UT', '2026-11-20', 'menno')).toBe(400);
		expect(refusal('UT', '2026-10-18', 'menno')).toBe(400);
		expect(refusal('UT', '2099-01-01', 'menno')).toBe(400);
	});

	it('refuses days that do not exist and unknown stations', () => {
		expect(refusal('UT', '2026-11-00', 'menno')).toBe(400);
		expect(refusal('UT', '2026-10-32', 'menno')).toBe(400);
		expect(refusal('XX', '2026-10-25', 'menno')).toBe(400);
	});
});
