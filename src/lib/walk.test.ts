import { describe, expect, it } from 'vitest';
import type { WalkListItem } from './types';
import {
	alongSentences,
	reverseWalk,
	walkDescription,
	walkHeading,
	walkPath,
	walkTitle,
	wandelnetCredit,
	wnwName
} from './walk';

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

const loop = (name: string, station: string): WalkListItem => ({
	...base,
	id: 'osm:1',
	name,
	isLoop: true,
	startStationName: station,
	endStationName: station,
	collection: 'lokaal'
});

describe("a walk's own page", () => {
	it('keeps the id readable in the URL', () => {
		expect(walkPath('osm:waterliniepad:HK-HLMS')).toBe('/route/osm:waterliniepad:HK-HLMS');
		expect(walkPath('a b/c')).toBe('/route/a%20b%2Fc');
	});

	it('names the stations and the distance in the title, in about 60 characters', () => {
		// Too long with the stations in: the name says the places already.
		expect(walkTitle(base)).toBe('Oranje-Nassaupad etappe 5: Rijen-Breda, 18,6 km');
		expect(walkTitle({ ...base, name: 'Rode route' })).toBe(
			'Rode route: Gilze-Rijen → Breda, 18,6 km'
		);
		expect(
			walkTitle({
				...base,
				name: 'Waterliniepad: Heemskerk – Breda',
				startStationName: 'Heemskerk'
			})
		).toBe('Waterliniepad: Heemskerk – Breda, 18,6 km');
		expect(walkTitle(loop('Brediusroute', 'Naarden-Bussum'))).toBe(
			'Brediusroute: rondje Naarden-Bussum, 18,6 km'
		);
	});

	it('keeps the titles of Wandelnet walks as they were', () => {
		expect(walkTitle({ ...base, source: 'wandelnet' })).toBe(
			'Oranje-Nassaupad etappe 5: Rijen-Breda (Gilze-Rijen → Breda, 18,6 km)'
		);
		expect(walkTitle({ ...loop('Brediusroute', 'Naarden-Bussum'), source: 'wandelnet' })).toBe(
			'Brediusroute: rondje vanaf Naarden-Bussum, 18,6 km'
		);
	});

	it("tidies a walking network's raw names, station first", () => {
		expect(wnwName('WNW Twente- Stokhorst - blauwe route')).toEqual({
			region: 'Twente',
			places: ['Stokhorst'],
			colour: 'blauwe'
		});
		expect(wnwName('WNW Noord-Veluwe - Elspeet - gele route')?.region).toBe('Noord-Veluwe');
		expect(wnwName('Brediusroute')).toBeNull();
		expect(walkTitle(loop('WNW Veluwe - Ellecom - gele route', 'Dieren'))).toBe(
			'Rondje Dieren: Ellecom gele route, 18,6 km'
		);
		// "Station Zwolle" and the station's own name say nothing new: the region does.
		const zwolle = loop('WNW IJsseldelta - Station Zwolle/Zwolle -groene route', 'Zwolle');
		expect(walkTitle(zwolle)).toBe('Rondje Zwolle: IJsseldelta groene route, 18,6 km');
		expect(walkHeading(zwolle)).toBe('IJsseldelta groene route');
		// As many places as fit.
		const many = loop(
			'WNW Veluwe - Buundekamp/Hoog-Wolfheze/Renkums Beekdal/Wolfheze - blauwe route',
			'Wolfheze'
		);
		expect(walkTitle(many)).toBe('Rondje Wolfheze: Buundekamp blauwe route, 18,6 km');
		expect(walkTitle(many).length).toBeLessThanOrEqual(60);
	});

	it('says in the description where you start and end, and what it passes, in 155 characters', () => {
		expect(walkDescription(base)).toBe(
			'Wandeling van 18,6 km van station Gilze-Rijen naar station Breda: Oranje-Nassaupad etappe 5: Rijen-Breda. Met de trein heen en terug.'
		);
		expect(walkDescription({ ...base, endStationM: 5000 })).toContain('(met een stuk bus)');
		const along = {
			places: ['Rijen', 'Molenschot', 'Ulvenhout', 'Bavel', 'Dorst', 'Breda'],
			nature: [],
			sights: [],
			cover: { forest: 40, heath: 20, builtUp: 20 },
			surface: { paved: 50, unpaved: 40 }
		};
		// At most four places, and not the stations it starts and ends at.
		expect(walkDescription(base, along)).toBe(
			'Wandeling van 18,6 km van station Gilze-Rijen naar station Breda, langs Rijen, Molenschot, Ulvenhout en Bavel, door bos en heide.'
		);
		expect(walkDescription(base, along).length).toBeLessThanOrEqual(155);
	});

	it('writes out what the walk passes', () => {
		expect(
			alongSentences(base, {
				places: ['Gilze-Rijen', 'Molenschot'],
				nature: ['Chaamse Bossen', 'Mastbos'],
				sights: ['molen De Hoop'],
				cover: { forest: 40, builtUp: 20 },
				surface: { paved: 50, unpaved: 40 }
			})
		).toEqual([
			'Onderweg kom je langs Molenschot.',
			'De route gaat door Chaamse Bossen en Mastbos.',
			'Ongeveer 40% van de route loopt door bos en 20% door bebouwd gebied.',
			'Volgens OpenStreetMap is ongeveer 50% van de route verhard en 40% onverhard; van de rest is het niet bekend.',
			'Bezienswaardig onderweg: molen De Hoop.'
		]);
		// Too little known about the surface to say anything.
		expect(
			alongSentences(base, {
				places: [],
				nature: [],
				sights: [],
				cover: {},
				surface: { paved: 20, unpaved: 10 }
			})
		).toEqual([]);
		expect(alongSentences(base, null)).toEqual([]);
	});
});

describe('reverseWalk', () => {
	const walk = {
		...base,
		geometry: [
			[4.9, 51.6],
			[4.8, 51.59],
			[4.78, 51.58]
		] as [number, number][],
		along: {
			places: ['Molenschot', 'Ulvenhout'],
			nature: ['Chaamse Bossen', 'Mastbos'],
			sights: [],
			cover: {},
			surface: { paved: 0, unpaved: 0 }
		}
	};

	it('swaps the ends and turns the line around', () => {
		const r = reverseWalk({ ...walk, startStationM: 100, endStationM: 2500 });
		expect([r.startStation, r.endStation]).toEqual(['BD', 'GZ']);
		expect([r.startStationName, r.startPlace, r.startStationM]).toEqual(['Breda', 'Breda', 2500]);
		expect(r.geometry).toEqual([
			[4.78, 51.58],
			[4.8, 51.59],
			[4.9, 51.6]
		]);
		expect(r.id).toBe(walk.id);
	});

	it('lists what it passes in the new walking order', () => {
		const r = reverseWalk(walk);
		expect(r.along?.places).toEqual(['Ulvenhout', 'Molenschot']);
		expect(r.along?.nature).toEqual(['Mastbos', 'Chaamse Bossen']);
	});

	it('leaves the walk it was given alone, and turns back into it', () => {
		const r = reverseWalk(walk);
		expect(walk.geometry[0]).toEqual([4.9, 51.6]);
		expect(reverseWalk(r)).toEqual(walk);
	});
});
