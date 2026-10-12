import { describe, expect, it } from 'vitest';
import {
	addMinutes,
	amsterdamIso,
	busMinutes,
	formatDuration,
	nextSaturdayMorning,
	travelBand,
	walkMinutes
} from './itinerary';

describe('itinerary', () => {
	it('estimates walking time with breaks per full 10 km', () => {
		expect(walkMinutes(9, { speedKmh: 4.5, breakMinPer10Km: 20 })).toBe(120);
		expect(walkMinutes(14.5, { speedKmh: 4.5, breakMinPer10Km: 20 })).toBe(213);
	});

	it('estimates bus legs conservatively, in 5-minute steps', () => {
		expect(busMinutes(6503)).toBe(30); // Wageningen → Ede-Wageningen
		expect(busMinutes(2000)).toBe(20);
	});

	it('uses the right Amsterdam UTC offset in summer and winter', () => {
		expect(amsterdamIso('2026-07-04', '09:00')).toBe('2026-07-04T09:00:00+02:00');
		expect(amsterdamIso('2026-12-05', '09:00')).toBe('2026-12-05T09:00:00+01:00');
	});

	it('picks the next Saturday morning', () => {
		// Monday 12 Oct 2026 → Saturday 17 Oct.
		expect(nextSaturdayMorning(new Date('2026-10-12T20:00:00+02:00'))).toBe(
			'2026-10-17T09:00:00+02:00'
		);
	});

	it('adds minutes across the hour', () => {
		expect(addMinutes('2026-10-17T09:50:00+02:00', 213)).toBe('2026-10-17T11:23:00.000Z');
	});

	it('formats durations and travel bands', () => {
		expect(formatDuration(45)).toBe('45 min');
		expect(formatDuration(83)).toBe('1u23');
		expect(travelBand(29)).toBe('near');
		expect(travelBand(95)).toBe('veryfar');
		expect(travelBand(null)).toBe('unknown');
	});
});
