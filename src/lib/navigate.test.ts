import { describe, expect, it } from 'vitest';
import type { LngLat } from './geo.js';
import {
	bearing,
	closestStations,
	compassWord,
	paceKmh,
	pointAlong,
	splitLine,
	startProgress,
	step,
	type Fix
} from './navigate.js';

// Due east along a parallel: 0.01° of longitude at 52°N is about 685 m.
const line: LngLat[] = Array.from({ length: 11 }, (_, i) => [5 + i / 100, 52]);
const M_PER_STEP = 685;
const at = (lng: number, minutes: number, latOff = 0): Fix => ({
	lng,
	lat: 52 + latOff,
	accuracyM: 10,
	time: minutes * 60_000
});
const walk = (fixes: Fix[]) => fixes.reduce((p, f) => step(p, f, line), startProgress(line));

describe('following a walk', () => {
	it("isn't off the route before you've reached it", () => {
		const p = walk([at(5, 0, 0.01), at(5, 1, 0.009)]);
		expect(p).toMatchObject({ started: false, offRoute: false });
		expect(p.offM).toBeGreaterThan(900);
	});

	it('follows you along the line', () => {
		const p = walk([at(5, 0), at(5.02, 15), at(5.04, 30)]);
		expect(p.started).toBe(true);
		expect(p.alongM).toBeGreaterThan(4 * M_PER_STEP - 20);
		expect(p.alongM).toBeLessThan(4 * M_PER_STEP + 20);
	});

	it('says you are off the route only once it lasts', () => {
		const off = 0.001; // ~110 m north of the line
		const stray = walk([at(5, 0), at(5.01, 10), at(5.01, 10.1, off)]);
		expect(stray.offRoute).toBe(false);
		const lasting = step(stray, at(5.01, 10.5, off), line);
		expect(lasting.offRoute).toBe(true);
		expect(step(lasting, at(5.012, 11), line).offRoute).toBe(false);
	});

	it('gives a fuzzy fix the benefit of the doubt', () => {
		const fuzzy = { ...at(5.01, 10.5, 0.0006), accuracyM: 40 }; // ~67 m off, ± 40 m
		const p = walk([at(5, 0), at(5.01, 10), { ...fuzzy, time: 10.1 * 60_000 }, fuzzy]);
		expect(p.offRoute).toBe(false);
	});

	it('notices you turned back, and forgets it once you go on', () => {
		const back = walk([at(5, 0), at(5.02, 15), at(5.03, 20), at(5.018, 23)]);
		expect(back.wrongWay).toBe(true);
		const ahead = walk([at(5, 0), at(5.02, 15), at(5.03, 20), at(5.029, 21)]);
		expect(ahead.wrongWay).toBe(false);
		// Long enough after, the turn back is the way you now go: right for an out-and-back.
		expect(step(back, at(5.017, 30), line).wrongWay).toBe(false);
	});

	it('measures your pace once you have walked a while', () => {
		expect(paceKmh(walk([at(5, 0), at(5.005, 5)]))).toBeNull();
		// 6 steps in 60 minutes: ~4.1 km/h.
		const p = walk([at(5, 0), at(5.02, 20), at(5.04, 40), at(5.06, 60)]);
		expect(paceKmh(p)).toBeCloseTo((6 * M_PER_STEP) / 1000, 1);
	});
});

describe('the line itself', () => {
	it('finds the spot some way along, and splits there', () => {
		const spot = pointAlong(line, 2.5 * M_PER_STEP);
		expect(spot[0]).toBeCloseTo(5.025, 3);
		const [behind, ahead] = splitLine(line, 2.5 * M_PER_STEP);
		expect(behind.at(-1)).toEqual(ahead[0]);
		expect(behind).toHaveLength(4);
		expect(ahead).toHaveLength(9);
	});

	it('puts a bearing in words', () => {
		expect(bearing([5, 52], [5, 52.1])).toBeCloseTo(0, 0);
		expect(compassWord(bearing([5, 52], [5.1, 52]))).toBe('oost');
		expect(compassWord(225)).toBe('zuidwest');
		expect(compassWord(-10)).toBe('noord');
	});
});

describe('stopping early', () => {
	it('lists the closest stations with the walk there', () => {
		const stations = [
			{ code: 'FAR', lat: 52.2, lng: 5 },
			{ code: 'NEAR', lat: 52.01, lng: 5 }
		];
		const [first] = closestStations([5, 52], stations, 1);
		expect(first.station.code).toBe('NEAR');
		expect(first.walkKm).toBeCloseTo(1.11 * 1.3, 1);
	});
});

describe('the trail', () => {
	it('keeps about one point per ten seconds', () => {
		const fixes = Array.from({ length: 60 }, (_, i) => ({
			lng: 5 + i * 0.00002,
			lat: 52,
			accuracyM: 5,
			time: i * 1000
		}));
		const p = walk(fixes);
		expect(p.trail.length).toBeLessThanOrEqual(8);
		expect(p.trail.at(-1)?.time).toBe(59_000);
	});
});
