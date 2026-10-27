import { describe, expect, it } from 'vitest';
import { haversine, lineLengthKm, locateOnLine, nearest, simplify, type LngLat } from './geo';

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

	it('finds how far along a route a point lies, and how far off it', () => {
		// About 1.37 km due east along 52° N, in two pieces.
		const line: LngLat[] = [
			[5, 52],
			[5.01, 52],
			[5.02, 52]
		];
		const spot = locateOnLine([5.015, 52.0009], line);
		expect(spot.alongM / spot.lengthM).toBeCloseTo(0.75, 2);
		expect(spot.offM).toBeCloseTo(100, -1);
	});

	it('keeps to the stretch you were on where a route passes the same spot twice', () => {
		// A loop: out east, a bend north, and back to the start.
		const loop: LngLat[] = [
			[5, 52],
			[5.02, 52],
			[5.02, 52.01],
			[5, 52.0002]
		];
		const atStart: LngLat = [5.0005, 52.0001];
		const { lengthM } = locateOnLine(atStart, loop);
		expect(locateOnLine(atStart, loop).alongM).toBeLessThan(100);
		expect(locateOnLine(atStart, loop, lengthM - 200).alongM).toBeGreaterThan(lengthM - 100);
	});

	it('says how far off the line you are, whichever stretch it follows on from', () => {
		// Out east, 20 m north, back west: two stretches side by side.
		const there: LngLat[] = [
			[5, 52],
			[5.01, 52],
			[5.01, 52.00018],
			[5, 52.00018]
		];
		const back = locateOnLine([5.002, 52], there, 1300);
		expect(back.alongM).toBeGreaterThan(1200); // the way back, where the last fix was
		expect(back.offM).toBeLessThan(1); // but you're right on the way out
	});

	it("lets go of a stretch close by once you're clearly on another", () => {
		// Out east, 60 m north, back west: the way back runs a street over from the way out.
		const there: LngLat[] = [
			[5, 52],
			[5.01, 52],
			[5.01, 52.00055],
			[5, 52.00055]
		];
		// The last fix was put on the way back; this one is right on the way out.
		expect(locateOnLine([5.002, 52], there, 1300).alongM).toBeLessThan(200);
	});
});
