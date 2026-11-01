import { afterEach, describe, expect, it, vi } from 'vitest';
import { delayMinutes, isClock, onePerDeparture, readLeaveTime } from './trains';
import type { TripLeg, TripOption } from './types';

const trip = (departure: string, arrival: string) => ({ departure, arrival }) as TripOption;

describe('the time you leave home', () => {
	afterEach(() => vi.unstubAllGlobals());
	const stored = (value: string | null) => vi.stubGlobal('localStorage', { getItem: () => value });

	it('takes whole times only', () => {
		expect(['00:00', '09:05', '23:59'].every(isClock)).toBe(true);
		expect(['', '9:05', '24:00', '12:60', '12:00:00'].some(isClock)).toBe(false);
	});

	it('comes back from storage, or else is 09:00', () => {
		stored('13:30');
		expect(readLeaveTime()).toBe('13:30');
		stored(null);
		expect(readLeaveTime()).toBe('09:00');
		stored('soon');
		expect(readLeaveTime()).toBe('09:00');
	});

	it('is 09:00 without storage', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('private mode');
			}
		});
		expect(readLeaveTime()).toBe('09:00');
	});
});

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
