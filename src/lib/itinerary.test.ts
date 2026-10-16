import { describe, expect, it } from 'vitest';
import {
	accessKm,
	accessMinutes,
	addMinutes,
	amsterdamIso,
	breakMinutes,
	busMinutes,
	formatDuration,
	nextSaturdayMorning,
	travelBand,
	walkMinutes
} from './itinerary';

describe('itinerary', () => {
	it('estimates walking time with breaks in proportion to distance, in 5-minute steps', () => {
		const pace = { speedKmh: 4.5, breakMinPer10Km: 20 };
		expect(breakMinutes(9, pace)).toBe(20); // 18 → 20
		expect(breakMinutes(14.5, pace)).toBe(30); // 29 → 30
		expect(breakMinutes(19.9, pace)).toBe(40); // no jump at 20 km any more
		expect(breakMinutes(20, pace)).toBe(40);
		expect(walkMinutes(14.5, pace)).toBe(193 + 30);
		expect(walkMinutes(14.5, { speedKmh: 4.5, breakMinPer10Km: 0 })).toBe(193);
	});

	it('estimates the walk between station and route with a detour on the straight line', () => {
		expect(accessKm(1708)).toBeCloseTo(2.2, 1); // Dordrecht Zuid → Hollandse Biesbosch
		expect(accessMinutes(1708)).toBe(30);
		expect(accessMinutes(1708, 6)).toBe(23);
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
