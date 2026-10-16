import { describe, expect, it } from 'vitest';
import { feederRide, lineName, stopsNear, type StopTime } from './feeders';

const at = (stopId: string, seq: number, min: number, extra: Partial<StopTime> = {}): StopTime => ({
	stopId,
	seq,
	arr: min * 60,
	dep: min * 60,
	pickup: true,
	dropOff: true,
	...extra
});

// Drunen (route end) → Den Bosch: the bus passes two stops in the village and two at the station.
const route = new Map([
	['drunen-markt', 120],
	['drunen-kerk', 600]
]);
const station = new Map([
	['den-bosch-west', 450],
	['den-bosch-busstation', 60]
]);
const trip = [
	at('waalwijk', 1, 900),
	at('drunen-kerk', 2, 910),
	at('drunen-markt', 3, 912),
	at('vlijmen', 4, 920),
	at('den-bosch-west', 5, 930),
	at('den-bosch-busstation', 6, 934)
];

describe('feederRide', () => {
	it('boards near the route end and alights at the stop closest to the station', () => {
		const ride = feederRide(trip, 'end', route, station);
		expect(ride?.board.stopId).toBe('drunen-markt');
		expect(ride?.alight.stopId).toBe('den-bosch-busstation');
		expect(ride?.stopM).toBe(120);
	});

	it('needs the trip to run the right way', () => {
		const back = trip.map((s, i) => ({ ...s, seq: trip.length - i }));
		expect(feederRide(back, 'end', route, station)).toBeNull();
		expect(feederRide(back, 'start', route, station)?.alight.stopId).toBe('drunen-markt');
	});

	it("skips stops where you can't get on or off", () => {
		const setDownOnly = trip.map((s) =>
			s.stopId === 'drunen-markt' ? { ...s, pickup: false } : s
		);
		expect(feederRide(setDownOnly, 'end', route, station)?.board.stopId).toBe('drunen-kerk');
	});
});

describe('stopsNear and lineName', () => {
	it('keeps stops within range, with their distance', () => {
		const stops = [
			{ id: 'a', name: 'A', at: [5.13, 51.68] as [number, number] },
			{ id: 'b', name: 'B', at: [5.2, 51.68] as [number, number] }
		];
		const near = stopsNear(stops, [5.131, 51.68], 800);
		expect([...near.keys()]).toEqual(['a']);
		expect(near.get('a')).toBeCloseTo(69, -1);
	});

	it('names lines by mode', () => {
		expect(lineName('3', '136')).toBe('Bus 136');
		expect(lineName('1', 'B')).toBe('Metro B');
		expect(lineName('4', '')).toBe('Veerboot');
	});
});
