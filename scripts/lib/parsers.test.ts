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

	it('lists all NS walks from the overview page', () => {
		const list = parseList(fixture('wandelnet-ns-list.html'));
		expect(list.length).toBeGreaterThanOrEqual(40);
		const tll = list.find((e) => e.id === '1333');
		expect(tll).toMatchObject({
			name: 'Tussen Lek en Linge',
			startPlace: 'Culemborg',
			endPlace: 'Beesd',
			statedKm: 14.5
		});
	});

	it('parses a route detail page', () => {
		const page = parseRoutePage(fixture('wandelnet-route-1333.html'));
		expect(page.name).toBe('Tussen Lek en Linge');
		expect(page.statedKm).toBe(14.5);
		expect(page.type).toBe('NS-Wandeling');
		expect(page.features).toContain('Landgoederen');
		expect(page.start?.[1]).toBeCloseTo(51.9471, 3);
		expect(page.end?.[1]).toBeCloseTo(51.8993, 3);
		expect(page.reviewCount).toBe(23);
		expect(page.gpxUrl).toBe('https://wandelnet.api.routemaker.nl/content/gpx/wandelnet/1333.gpx');
		expect(page.reviewUrl).toMatch(/\/wandelroute\/1333\/.+\/review$/);
	});

	it('averages star ratings from the review tab', () => {
		const { count, average } = parseReviews(fixture('wandelnet-review-1333.html'));
		expect(count).toBe(23);
		expect(average).toBeGreaterThanOrEqual(1);
		expect(average).toBeLessThanOrEqual(5);
	});
});

describe('wandelnet paths', () => {
	it('reads a streekpad page and its numbered stages, skipping side routes', () => {
		const html = fixture('wandelnet-betuwepad.html');
		expect(parsePathPage(html).name).toBe('Betuwepad');
		expect(parsePathPage(html).intro).toMatch(/146 kilometer/);
		const stages = parseList(html).filter((e) => stageNumber(e) !== null);
		expect(stages).toHaveLength(12);
		expect(stages[0]).toMatchObject({ startPlace: 'Station Tiel', endPlace: 'Buren' });
		expect(stageNumber({ ...stages[0], name: 'Etappe 07' })).toBe(7);
	});
});

describe('ns.nl', () => {
	it('extracts stations, paved %, dogs and photos', () => {
		const page = parseWalkPage(fixture('nsnl-tussen-lek-en-linge.html'));
		expect(page.wandelnetId).toBe('1333');
		expect(page.fromStation).toBe('Culemborg');
		expect(page.toStation).toBe('Beesd');
		expect(page.pavedPct).toBe(40);
		expect(page.dogs).toMatch(/^Nee/);
		expect(page.photos.length).toBe(3);
		expect(page.photos[0].url).toMatch(/\/960\/.+\.webp$/);
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
