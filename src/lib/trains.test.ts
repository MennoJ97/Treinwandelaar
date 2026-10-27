import { describe, expect, it } from 'vitest';
import { delayMinutes, onePerDeparture } from './trains';
import type { TripLeg, TripOption } from './types';

const trip = (departure: string, arrival: string) => ({ departure, arrival }) as TripOption;

describe('trains on the day page', () => {
	it('keeps one trip per departure, the one home first', () => {
		const trips = onePerDeparture([
			trip('2026-10-27T15:44:00+01:00', '2026-10-27T16:30:00+01:00'),
			trip('2026-10-27T15:44:00+01:00', '2026-10-27T16:11:00+01:00'),
			trip('2026-10-27T15:54:00+01:00', '2026-10-27T16:21:00+01:00')
		]);
		expect(trips.map((t) => t.arrival.slice(11, 16))).toEqual(['16:11', '16:21']);
	});

	it('counts a delay in whole minutes, never early', () => {
		const leg = (plannedDeparture: string, departure: string) =>
			({ plannedDeparture, departure }) as TripLeg;
		expect(delayMinutes(leg('2026-10-27T15:44:00+01:00', '2026-10-27T15:47:00+01:00'))).toBe(3);
		expect(delayMinutes(leg('2026-10-27T15:44:00+01:00', '2026-10-27T15:43:00+01:00'))).toBe(0);
	});
});
