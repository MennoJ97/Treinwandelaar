import { describe, expect, it } from 'vitest';
import type { LngLat } from './geo';
import {
	amsterdamMinutes,
	cellKey,
	decodeMasks,
	dryBand,
	dryChance,
	dryLabel,
	encodeMasks,
	pointsAlong,
	rainAlong,
	toForecast,
	walkHours,
	type DayForecast
} from './weather';

const bit = (hour: number) => 1 << (hour - 6);

/** Along one parallel, in one ensemble cell from 5.00 to 5.12 and the next from 5.13 on. */
const LINE: LngLat[] = [
	[5.0, 52.0],
	[5.2, 52.0]
];

function forecast(cells: Record<string, number[]>, hourly: Record<string, number[]> = {}) {
	return {
		date: '2026-10-31',
		masks: new Map(Object.entries(cells).map(([c, m]) => [c, Uint32Array.from(m)])),
		hourly
	} satisfies DayForecast;
}

describe('weather', () => {
	it('snaps a place to the nearest grid point', () => {
		expect(cellKey([5.1, 52.1], 0.25)).toBe('52.00,5.00');
		expect(cellKey([5.13, 52.13], 0.25)).toBe('52.25,5.25');
		expect(cellKey([4.96, 52.04], 0.1)).toBe('52.00,5.00');
	});

	it('round-trips masks through base64, the top bits too', () => {
		const masks = Uint32Array.from([0, 1, 0x1ffff, 0xffffffff]);
		const base64 = Buffer.from(encodeMasks(masks)).toString('base64');
		expect([...decodeMasks(base64)]).toEqual([...masks]);
		expect(
			toForecast({ date: 'x', fetchedAt: 0, ensemble: { c: base64 }, hourly: {} }).masks.get('c')
		).toEqual(masks);
	});

	it('reads Amsterdam time in both seasons', () => {
		expect(amsterdamMinutes(new Date('2026-07-01T08:30:00Z'))).toBe(10 * 60 + 30);
		expect(amsterdamMinutes(new Date('2026-12-01T08:30:00Z'))).toBe(9 * 60 + 30);
	});

	it('lists the hours a walk overlaps, with where you are halfway through each', () => {
		expect(walkHours(10 * 60, 120)).toEqual([
			{ hour: 10, along: 0.25 },
			{ hour: 11, along: 0.75 }
		]);
		expect(walkHours(10 * 60 + 30, 60)?.map((h) => h.hour)).toEqual([10, 11]);
		// Ending on the hour doesn't touch the next one.
		expect(walkHours(10 * 60, 60)?.map((h) => h.hour)).toEqual([10]);
	});

	it('refuses a walk outside the hours a forecast holds', () => {
		expect(walkHours(5 * 60 + 59, 60)).toBeNull();
		expect(walkHours(20 * 60, 181)).toBeNull();
		expect(walkHours(20 * 60, 180)).not.toBeNull();
		expect(walkHours(10 * 60, 0)).toBeNull();
	});

	it('finds points by distance along the line, not by vertex', () => {
		const line: LngLat[] = [
			[0, 0],
			[0, 1],
			[0, 4]
		];
		const [a, b, c] = pointsAlong(line, [0, 0.5, 1]);
		expect(a).toEqual([0, 0]);
		expect(b[1]).toBeCloseTo(2, 5);
		expect(c[1]).toBeCloseTo(4, 5);
	});

	it('copes with a line whose points coincide', () => {
		const same: LngLat[] = [
			[5, 52],
			[5, 52]
		];
		expect(pointsAlong(same, [0.5])).toEqual([[5, 52]]);
	});

	it('counts scenarios dry for the whole walk, across the hours', () => {
		// Two wet hours in one scenario are one wet scenario; multiplied hourly chances would say 56%.
		const f = forecast({
			'52.00,5.00': [bit(10) | bit(11), 0, 0, 0],
			'52.00,5.25': [0, 0, 0, 0]
		});
		expect(dryChance(LINE, 10 * 60, 90, f)).toBe(0.75);
	});

	it('only counts rain in the hours you walk', () => {
		const f = forecast({ '52.00,5.00': [bit(15), bit(9)], '52.00,5.25': [0, 0] });
		expect(dryChance(LINE, 10 * 60, 60, f)).toBe(1);
	});

	it('looks up the cell you are in that hour, by scenario', () => {
		const f = forecast({
			// Rain in the first cell only after you've left it; in the second as you walk through.
			'52.00,5.00': [bit(13), 0],
			'52.00,5.25': [0, bit(13)]
		});
		expect(dryChance(LINE, 10 * 60, 240, f)).toBe(0.5);
	});

	it('says nothing without a line, or for a cell the download lacks', () => {
		const f = forecast({ '52.00,5.00': [0] });
		expect(dryChance([], 10 * 60, 60, f)).toBeNull();
		expect(dryChance(LINE, 10 * 60, 240, f)).toBeNull();
		expect(dryChance(LINE, 3 * 60, 60, f)).toBeNull();
	});

	it('reads the hourly forecast along the walk', () => {
		const mm = Array.from({ length: 17 }, (_, i) => i / 10);
		const f = forecast({}, { '52.00,5.00': mm, '52.00,5.20': mm });
		expect(rainAlong(LINE, 10 * 60, 120, f)).toEqual([
			{ hour: 10, mm: 0.4 },
			{ hour: 11, mm: 0.5 }
		]);
		expect(rainAlong(LINE, 10 * 60, 120, forecast({}))).toBeNull();
	});

	it('labels and bands the chance', () => {
		expect(dryLabel(0.83)).toBe('85% droog');
		expect(dryLabel(1)).toBe('100% droog');
		expect(dryBand(0.84)).toBe(8);
		expect(dryBand(0.86)).toBe(9);
		expect(dryBand(null)).toBe(-1);
	});
});
