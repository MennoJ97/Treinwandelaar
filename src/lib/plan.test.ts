import { describe, expect, it } from 'vitest';
import { dropTrains, readPlan, writePlan } from './plan';

describe('trip plan in the link', () => {
	it('round-trips through the query string', () => {
		const params = new URLSearchParams('walk=osm%3A1');
		writePlan(params, { date: '2026-10-31', time: '09:15', out: '09:21', back: '16:42' });
		expect(params.toString()).toBe('walk=osm%3A1&date=2026-10-31&time=0915&out=0921&back=1642');
		expect(readPlan(params)).toEqual({
			date: '2026-10-31',
			time: '09:15',
			out: '09:21',
			back: '16:42'
		});
	});

	it('leaves out trains not picked, and drops them on their own', () => {
		const params = new URLSearchParams();
		writePlan(params, { date: '2026-10-31', time: '09:15', out: '09:21', back: null });
		expect(params.has('back')).toBe(false);
		dropTrains(params);
		expect(params.toString()).toBe('date=2026-10-31&time=0915');
	});

	it('ignores a link without a usable date and time', () => {
		expect(readPlan(new URLSearchParams('date=2026-10-31'))).toBeNull();
		expect(readPlan(new URLSearchParams('date=morgen&time=0915'))).toBeNull();
		expect(readPlan(new URLSearchParams('date=2026-10-31&time=2575'))).toBeNull();
		expect(readPlan(new URLSearchParams('date=2026-10-31&time=0915&out=x'))?.out).toBeNull();
	});
});
