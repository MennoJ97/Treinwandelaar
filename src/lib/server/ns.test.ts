import { describe, expect, it } from 'vitest';
import { mapStation, mapTrip, normalizeTime } from './ns';

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
