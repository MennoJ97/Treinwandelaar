import { describe, expect, it } from 'vitest';
import {
	busStation,
	feederRide,
	lineName,
	stationStops,
	stationsReached,
	stopsNear,
	type StopTime
} from './feeders';

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

describe('stationsReached', () => {
	// Den Bosch's bus stops, and one in Vlijmen that is near a (made-up) station of its own.
	const stationOf = new Map([
		['den-bosch-west', 'HT'],
		['den-bosch-busstation', 'HT'],
		['vlijmen', 'VLM']
	]);

	it('lists every station the trip runs to, with the shortest ride', () => {
		const reached = stationsReached(trip, 'end', route, stationOf);
		expect(Object.fromEntries(reached)).toEqual({ VLM: 8 * 60, HT: 18 * 60 });
	});

	it('runs from the station for a route start', () => {
		const back = trip.map((s, i) => ({ ...s, seq: trip.length - i }));
		expect(stationsReached(trip, 'start', route, stationOf).size).toBe(0);
		// Reversed, minutes stay as they were, so measure only which stations it finds.
		expect([...stationsReached(back, 'start', route, stationOf).keys()].sort()).toEqual([
			'HT',
			'VLM'
		]);
	});
});

describe('stopsNear, stationStops and lineName', () => {
	it('gives each stop near a station to the closest one', () => {
		const stops = [{ id: 'a', name: 'A', at: [5.13, 51.68] as [number, number] }];
		const stations = [
			{ code: 'FAR', at: [5.135, 51.68] as [number, number] },
			{ code: 'NEAR', at: [5.131, 51.68] as [number, number] }
		];
		expect(stationStops(stops, stations, 500).get('a')).toBe('NEAR');
	});

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

describe('busStation', () => {
	// Zuidlaren: buses to Groningen (25 min) and to Assen (35 min), both ways; one to Haren only out.
	const village = new Map([['zuidlaren', 100]]);
	const stationOf = new Map([
		['gn-bus', 'GN'],
		['asn-bus', 'ASN'],
		['hrn-bus', 'HRN']
	]);
	const there = (stop: string, min: number) => [at(stop, 1, 0), at('zuidlaren', 2, min)];
	const back = (stop: string, min: number) => [at('zuidlaren', 1, 0), at(stop, 2, min)];
	const times = (n: number, make: () => StopTime[]) => Array.from({ length: n }, make);

	it('picks the station with rides both ways and the shortest ride', () => {
		const trips = [
			...times(30, () => there('asn-bus', 35)),
			...times(30, () => back('asn-bus', 35)),
			...times(30, () => there('gn-bus', 25)),
			...times(30, () => back('gn-bus', 25)),
			...times(30, () => there('hrn-bus', 10))
		];
		expect(busStation(trips, village, stationOf)).toEqual({ code: 'GN', minutes: 25 });
	});

	it('wants a bus most days, not the odd one', () => {
		const trips = [...times(3, () => there('gn-bus', 25)), ...times(3, () => back('gn-bus', 25))];
		expect(busStation(trips, village, stationOf)).toBeNull();
	});
});
