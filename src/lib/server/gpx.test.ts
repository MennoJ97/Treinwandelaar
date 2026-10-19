import { describe, expect, it } from 'vitest';
import type { WalkDetail } from '../types';
import { gpxFilename, walkGpx } from './gpx';

const walk = (over: Partial<WalkDetail> = {}): WalkDetail => ({
	id: 'osm:1-01',
	name: 'Pelgrimspad 01: Amsterdam – Weesp',
	source: 'osm',
	collection: 'law',
	startStation: 'ASD',
	endStation: 'WP',
	startStationName: 'Amsterdam Centraal',
	endStationName: 'Weesp',
	startPlace: null,
	endPlace: null,
	startStationM: 300,
	endStationM: 400,
	isLoop: false,
	distanceKm: 14.24,
	pavedPct: null,
	ratingAvg: null,
	reviewCount: 0,
	thumbnail: null,
	status: null,
	ownRating: null,
	geometry: [
		[4.90016, 52.37887],
		[4.95, 52.35],
		[5.04, 52.30768]
	],
	description: 'Langs de Amstel & de Vecht.',
	accessibility: null,
	features: [],
	dogs: null,
	sourceUrl: 'https://www.openstreetmap.org/relation/1',
	nsUrl: null,
	gpxUrl: null,
	photos: [],
	notes: null,
	...over
});

describe('walkGpx', () => {
	it('writes the line as track points, latitude first', () => {
		const gpx = walkGpx(walk());
		expect(gpx.match(/<trkpt /g)).toHaveLength(3);
		expect(gpx).toContain('<trkpt lat="52.37887" lon="4.90016"/>');
	});

	it('carries the ODbL attribution, and Wandelnet as the owner of a LAW route', () => {
		const gpx = walkGpx(walk());
		expect(gpx).toContain(
			'<copyright author="OpenStreetMap-bijdragers"><license>https://opendatacommons.org/licenses/odbl/1-0/</license></copyright>'
		);
		expect(gpx).toContain(
			'Route van Stichting Wandelnet, ingetekend door OpenStreetMap-bijdragers.'
		);
		expect(walkGpx(walk({ collection: 'lokaal' }))).not.toContain('Wandelnet');
	});

	it("marks Wandelnet's own data as for own use only", () => {
		const gpx = walkGpx(walk({ source: 'wandelnet', collection: 'streekpad' }));
		expect(gpx).toContain('<copyright author="Stichting Wandelnet">');
		expect(gpx).toContain('Alleen voor eigen gebruik.');
		expect(gpx).not.toContain('odbl');
	});

	it('escapes text and names the stations', () => {
		const gpx = walkGpx(walk());
		expect(gpx).toContain('Langs de Amstel &amp; de Vecht.');
		expect(gpx).toContain('Amsterdam Centraal – Weesp, 14,2 km (LAW-route)');
	});
});

describe('gpxFilename', () => {
	it('keeps it to ASCII', () => {
		expect(gpxFilename(walk({ name: 'Rondje Ée & Zuiderzeepad' }))).toBe(
			'rondje-ee-zuiderzeepad.gpx'
		);
	});
});
