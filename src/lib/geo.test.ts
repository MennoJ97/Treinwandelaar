import { describe, expect, it } from 'vitest';
import { haversine, lineLengthKm, nearest, simplify, type LngLat } from './geo';

const utrecht: LngLat = [5.1098, 52.0894];
const amsterdam: LngLat = [4.9006, 52.3789];

describe('geo', () => {
	it('computes great-circle distance', () => {
		// Utrecht Centraal ↔ Amsterdam Centraal is ~35 km as the crow flies.
		expect(haversine(utrecht, amsterdam) / 1000).toBeCloseTo(35.2, 0);
	});

	it('finds the nearest station within range only', () => {
		const stations = [
			{ code: 'CL', lat: 51.9468, lng: 5.2271 },
			{ code: 'BSD', lat: 51.8908, lng: 5.1924 }
		];
		const gpxStart: LngLat = [5.22688, 51.9471];
		expect(nearest(gpxStart, stations, 1500)?.item.code).toBe('CL');
		expect(nearest(utrecht, stations, 1500)).toBeNull();
	});

	it('simplifies a straight line to its endpoints but keeps length', () => {
		const line: LngLat[] = Array.from({ length: 50 }, (_, i) => [5 + i * 0.001, 52]);
		const simple = simplify(line, 5);
		expect(simple).toHaveLength(2);
		expect(lineLengthKm(simple)).toBeCloseTo(lineLengthKm(line), 3);
	});

	it('keeps corners above tolerance', () => {
		const corner: LngLat[] = [
			[5, 52],
			[5.005, 52],
			[5.01, 52],
			[5.01, 52.005]
		];
		expect(simplify(corner, 10)).toEqual([corner[0], corner[2], corner[3]]);
	});
});
