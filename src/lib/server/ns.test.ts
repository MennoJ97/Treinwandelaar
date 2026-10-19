import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapStation, mapTrip, normalizeTime } from './ns';
import { buildRailNetwork } from './railMap';

const track = (from: string, to: string, coordinates: number[][]) => ({
	type: 'Feature',
	properties: { from, to },
	geometry: { type: 'LineString', coordinates }
});

// Recorded from the real Reisinformatie API v3 (Utrecht Centraal → Culemborg), trimmed to the fields we use
// (share links shortened).
const recorded = JSON.parse(
	readFileSync(new URL('./__fixtures__/ns-trips-ut-cl.json', import.meta.url), 'utf8')
);

// Hand-written in the shape of a Reisinformatie API v3 trip (trimmed). Replace with a recorded
// response once an NS_API_KEY is available, to pin the mapping to the real payload.
const trip = {
	plannedDurationInMinutes: 23,
	actualDurationInMinutes: 25,
	transfers: 1,
	status: 'NORMAL',
	crowdForecast: 'MEDIUM',
	shareUrl: { uri: 'https://www.ns.nl/rpx?ctx=abc' },
	legs: [
		{
			name: 'NS Sprinter 6024',
			direction: 'Tiel',
			cancelled: false,
			product: { displayName: 'NS Sprinter' },
			origin: {
				name: 'Utrecht Centraal',
				plannedDateTime: '2026-10-17T09:12:00+0200',
				actualDateTime: '2026-10-17T09:14:00+0200',
				plannedTrack: '5'
			},
			destination: { name: 'Geldermalsen', plannedDateTime: '2026-10-17T09:27:00+0200' }
		},
		{
			name: 'Arriva Stoptrein',
			direction: 'Dordrecht',
			cancelled: false,
			product: { displayName: 'Arriva Stoptrein' },
			origin: {
				name: 'Geldermalsen',
				plannedDateTime: '2026-10-17T09:31:00+0200',
				plannedTrack: '1'
			},
			destination: { name: 'Beesd', plannedDateTime: '2026-10-17T09:37:00+0200' }
		}
	]
};

describe('NS mapping', () => {
	it('normalizes NS offsets to RFC3339', () => {
		expect(normalizeTime('2026-10-17T09:12:00+0200')).toBe('2026-10-17T09:12:00+02:00');
		expect(normalizeTime('2026-10-17T09:12:00+02:00')).toBe('2026-10-17T09:12:00+02:00');
	});

	it('maps a trip with a transfer and a delay', () => {
		const t = mapTrip(trip);
		expect(t.departure).toBe('2026-10-17T09:14:00+02:00'); // actual beats planned
		expect(t.arrival).toBe('2026-10-17T09:37:00+02:00');
		expect(t.transfers).toBe(1);
		expect(t.crowdForecast).toBe('MEDIUM');
		expect(t.shareUrl).toBe('https://www.ns.nl/rpx?ctx=abc');
		expect(t.legs.map((l) => l.product)).toEqual(['NS Sprinter', 'Arriva Stoptrein']);
		expect(t.legs[0].plannedDeparture).not.toBe(t.legs[0].departure);
	});

	it('maps a recorded real response', () => {
		const [t] = recorded.trips.map((r: unknown) => mapTrip(r));
		expect(t.departure).toBe('2026-10-17T08:50:00+02:00'); // actualDateTime is null → planned
		expect(t.arrival).toBe('2026-10-17T09:08:00+02:00');
		expect(t.plannedDurationMin).toBe(18);
		expect(t.transfers).toBe(0);
		expect(t.legs[0]).toMatchObject({
			category: 'SPR',
			isBus: false,
			product: 'NS Sprinter',
			track: '21',
			from: 'Utrecht Centraal'
		});
		expect(t.shareUrl).toMatch(/^https:\/\/www\.ns\.nl\/rpx\?ctx=/);
	});

	it('draws a leg along the tracks between its stops, or straight without the network', () => {
		const stop = (uicCode: string, lng: number, lat: number) => ({ uicCode, lng, lat });
		const leg = {
			...trip.legs[0],
			product: { displayName: 'NS Intercity', type: 'TRAIN' },
			stops: [stop('1', 5.0, 52.0), stop('3', 5.02, 52.0)]
		};
		// The intercity skips the middle station; the track there bends north.
		const network = buildRailNetwork([
			track('a', 'b', [
				[5.0, 52.0],
				[5.01, 52.003]
			]),
			track('b', 'c', [
				[5.01, 52.003],
				[5.02, 52.0]
			])
		]);
		const codes = new Map([
			['1', 'A'],
			['3', 'C']
		]);
		const straight = mapTrip({ legs: [leg] }).legs[0].line;
		expect(straight).toEqual([
			[5.0, 52.0],
			[5.02, 52.0]
		]);
		const onTrack = mapTrip({ legs: [leg] }, { network, codes }).legs[0].line;
		expect(onTrack).toEqual([
			[5.0, 52.0],
			[5.01, 52.003],
			[5.02, 52.0]
		]);
		// A bus doesn't run on rails.
		const bus = { ...leg, product: { type: 'BUS' } };
		expect(mapTrip({ legs: [bus] }, { network, codes }).legs[0].line).toEqual(straight);
	});

	it('maps both station payload shapes', () => {
		expect(
			mapStation({
				id: { code: 'ut', uicCode: '8400621' },
				names: { long: 'Utrecht Centraal' },
				location: { lat: 52.09, lng: 5.11 }
			})
		).toEqual({ code: 'UT', uic: '8400621', name: 'Utrecht Centraal', lat: 52.09, lng: 5.11 });
		expect(
			mapStation({
				code: 'CL',
				namen: { lang: 'Culemborg' },
				lat: 51.95,
				lng: 5.23,
				UICCode: 8400160
			})?.name
		).toBe('Culemborg');
		expect(mapStation({ names: { long: 'No location' } })).toBeNull();
	});
});
