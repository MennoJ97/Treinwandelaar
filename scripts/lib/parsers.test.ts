import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	parseKm,
	parseList,
	parsePathPage,
	parseReviews,
	parseRoutePage,
	splitPlaces,
	stageNumber
} from './wandelnet';
import { parseWalkPage } from './nsnl';

// Fixtures are hand-written in the shape of the real pages: Wandelnet's and NS's content may not be
// republished, so only the markup the parsers rely on is kept.
const fixture = (name: string) =>
	readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

describe('wandelnet', () => {
	it('parses distances in both list and detail formats', () => {
		expect(parseKm('Lengte: 14.5 KM')).toBe(14.5);
		expect(parseKm('Culemborg - Beesd (14,5 km)')).toBe(14.5);
		expect(parseKm('no distance')).toBeNull();
	});

	it('splits place pairs without breaking hyphenated names', () => {
		expect(splitPlaces('Culemborg - Beesd')).toEqual(['Culemborg', 'Beesd']);
		expect(splitPlaces('Driebergen-Zeist - Maarn')).toEqual(['Driebergen-Zeist', 'Maarn']);
	});

	it('lists all NS walks from the overview page, once each', () => {
		const list = parseList(fixture('wandelnet-list.html'));
		expect(list.map((e) => e.id)).toEqual(['9001', '9002', '9003']);
		expect(list[0]).toMatchObject({
			name: 'Langs de Proefdijk',
			startPlace: 'Zuidstad',
			endPlace: 'Noorddorp',
			statedKm: 14.5
		});
		expect(list[0].image).toMatch(/width=800&height=400$/);
		// "8.5 of 10.6 KM": the number right before "km" wins, i.e. the longer variant.
		expect(list[1]).toMatchObject({ startPlace: 'Molendorp', endPlace: null, statedKm: 10.6 });
		expect(list[2]).toMatchObject({ startPlace: 'Driebergen-Zeist', endPlace: 'Maarn' });
	});

	it('parses a route detail page', () => {
		const page = parseRoutePage(fixture('wandelnet-route.html'));
		expect(page.name).toBe('Langs de Proefdijk');
		expect(page).toMatchObject({ startPlace: 'Zuidstad', endPlace: 'Noorddorp' });
		expect(page.statedKm).toBe(14.5);
		expect(page.type).toBe('NS-Wandeling');
		expect(page.features).toContain('Landgoederen');
		expect(page.start?.[1]).toBeCloseTo(51.9471, 3);
		expect(page.end?.[1]).toBeCloseTo(51.8993, 3);
		expect(page.reviewCount).toBe(4);
		expect(page.gpxUrl).toBe('https://wandelnet.api.routemaker.nl/content/gpx/wandelnet/9001.gpx');
		expect(page.reviewUrl).toBe(
			'https://www.wandelnet.nl/wandelroute/9001/Langs-de-Proefdijk/review'
		);
		expect(page.headerImage).toMatch(/img-C1000x550\.jpg$/);
	});

	it('averages star ratings from the review tab', () => {
		expect(parseReviews(fixture('wandelnet-review.html'))).toEqual({ count: 4, average: 3.8 });
		expect(parseReviews('<p>Nog geen reviews</p>')).toEqual({ count: 0, average: null });
	});
});

describe('wandelnet paths', () => {
	it('reads a streekpad page and its numbered stages, skipping side routes', () => {
		const html = fixture('wandelnet-path.html');
		expect(parsePathPage(html).name).toBe('Proefdijkpad');
		expect(parsePathPage(html).intro).toMatch(/42 kilometer/);
		const stages = parseList(html).filter((e) => stageNumber(e) !== null);
		expect(stages).toHaveLength(3);
		expect(stages[0]).toMatchObject({ startPlace: 'Station Zuidstad', endPlace: 'Molendorp' });
		expect(stageNumber({ ...stages[0], name: 'Etappe 07' })).toBe(7);
	});
});

describe('ns.nl', () => {
	it('extracts stations, paved %, dogs and photos', () => {
		const page = parseWalkPage(fixture('nsnl-walk.html'));
		expect(page.wandelnetId).toBe('9001');
		expect(page.fromStation).toBe('Zuidstad');
		expect(page.toStation).toBe('Noorddorp');
		expect(page.pavedPct).toBe(40);
		expect(page.dogs).toMatch(/^Nee/);
		expect(page.photos.length).toBe(3);
		expect(page.photos[0].url).toMatch(/\/960\/.+\.webp$/);
		expect(page.photos[2].caption).toBe('Proef uitzicht op noorddorp');
		expect(page.goodToKnow).toBe('Onderweg is een theetuin.');
	});
});

describe('gtfs csv', () => {
	it('splits quoted fields and converts times past midnight', async () => {
		const { parseCsvLine, gtfsTime } = await import('./csv');
		expect(parseCsvLine('1,"Den Haag, Centraal",x')).toEqual(['1', 'Den Haag, Centraal', 'x']);
		expect(parseCsvLine('a,"say ""hi""",')).toEqual(['a', 'say "hi"', '']);
		expect(gtfsTime('25:10:00')).toBe(25 * 3600 + 600);
	});
});
