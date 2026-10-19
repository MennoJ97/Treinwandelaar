import { describe, expect, it } from 'vitest';
import type { WalkListItem } from './types';
import { walkDescription, walkPath, walkTitle, wandelnetCredit } from './walk';

describe('wandelnetCredit', () => {
	it('dates the credit the Dutch way', () => {
		expect(wandelnetCredit('2026-10-12')).toBe(
			'Routedata © Stichting Wandelnet, bijgewerkt 12-10-2026'
		);
	});

	it('leaves the date out until an ingest has recorded one', () => {
		expect(wandelnetCredit(null)).toBe('Routedata © Stichting Wandelnet');
	});
});

const base: WalkListItem = {
	id: 'osm:21255748:GZ-BD',
	name: 'Oranje-Nassaupad etappe 5: Rijen-Breda',
	source: 'osm',
	collection: 'streekpad',
	startStation: 'GZ',
	endStation: 'BD',
	startStationName: 'Gilze-Rijen',
	endStationName: 'Breda',
	startPlace: 'Gilze-Rijen',
	endPlace: 'Breda',
	startStationM: 100,
	endStationM: 100,
	isLoop: false,
	distanceKm: 18.6,
	pavedPct: null,
	ratingAvg: null,
	reviewCount: 0,
	thumbnail: null,
	status: null,
	ownRating: null
};

describe("a walk's own page", () => {
	it('keeps the id readable in the URL', () => {
		expect(walkPath('osm:waterliniepad:HK-HLMS')).toBe('/route/osm:waterliniepad:HK-HLMS');
		expect(walkPath('a b/c')).toBe('/route/a%20b%2Fc');
	});

	it('names the stations and the distance in the title', () => {
		expect(walkTitle(base)).toBe(
			'Oranje-Nassaupad etappe 5: Rijen-Breda (Gilze-Rijen → Breda, 18,6 km)'
		);
		expect(
			walkTitle({
				...base,
				name: 'Waterliniepad: Heemskerk – Breda',
				startStationName: 'Heemskerk'
			})
		).toBe('Waterliniepad: Heemskerk – Breda, 18,6 km');
		expect(
			walkTitle({ ...base, name: 'Brediusroute', isLoop: true, startStationName: 'Naarden-Bussum' })
		).toBe('Brediusroute: rondje vanaf Naarden-Bussum, 18,6 km');
		expect(walkTitle({ ...base, name: 'Rode route' })).toBe(
			'Rode route: Gilze-Rijen → Breda, 18,6 km'
		);
	});

	it('says in the description where you start and end, and when it takes a bus', () => {
		expect(walkDescription(base)).toMatch(
			/^Wandeling van station Gilze-Rijen naar station Breda, 18,6 km:/
		);
		expect(walkDescription({ ...base, endStationM: 5000 })).toContain('met een stuk bus');
	});
});
