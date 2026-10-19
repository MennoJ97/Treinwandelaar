import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSchema } from '../../src/lib/server/db';
import { saveWalk, type WalkRecord } from './store';

const walk: WalkRecord = {
	id: 'osm:1',
	source: 'osm',
	sourceId: '1',
	collection: 'lokaal',
	name: 'Rode route',
	startPlace: 'Uitgeest',
	endPlace: 'Uitgeest',
	startStation: 'UTG',
	endStation: 'UTG',
	startStationM: 120,
	endStationM: 120,
	isLoop: true,
	distanceKm: 11.4,
	statedDistanceKm: null,
	description: null,
	accessibility: null,
	features: [],
	track: [
		[4.7, 52.5],
		[4.71, 52.51]
	],
	ratingAvg: null,
	reviewCount: 0,
	sourceUrl: 'https://www.openstreetmap.org/relation/1',
	gpxUrl: null,
	photos: []
};

describe('changed_on, the sitemap lastmod', () => {
	const db = new DatabaseSync(':memory:');
	initSchema(db);
	db.exec(`insert into stations (code, name, lat, lng) values ('UTG', 'Uitgeest', 52.5, 4.7)`);
	const changedOn = () =>
		(db.prepare(`select changed_on from walks where id = 'osm:1'`).get() as { changed_on: string })
			.changed_on;
	// As if the walk had been saved on an earlier day.
	const backdate = () => db.exec(`update walks set changed_on = '2026-01-01'`);

	it('is the day a walk first comes in', () => {
		saveWalk(db, walk);
		expect(changedOn()).toBe(new Date().toISOString().slice(0, 10));
	});

	it('stays put when an ingest brings the same data', () => {
		backdate();
		saveWalk(db, walk);
		saveWalk(db, { ...walk, wandelnetDuplicate: true });
		expect(changedOn()).toBe('2026-01-01');
	});

	it('moves when the route or its text changes, a null included', () => {
		backdate();
		saveWalk(db, { ...walk, track: [...walk.track, [4.72, 52.52]] });
		expect(changedOn()).not.toBe('2026-01-01');
		backdate();
		saveWalk(db, { ...walk, description: 'Route van Staatsbosbeheer.' });
		expect(changedOn()).not.toBe('2026-01-01');
		backdate();
		saveWalk(db, walk);
		expect(changedOn()).not.toBe('2026-01-01');
	});

	it('is filled in from updated_at for rows from before the column', () => {
		const old = new DatabaseSync(':memory:');
		initSchema(old);
		old.exec(`alter table walks drop column changed_on`);
		old.exec(`insert into walks (id, source, source_id, collection, name, distance_km, geometry,
			source_url, updated_at) values ('osm:2', 'osm', '2', 'law', 'X', 1, '[]', 'u', '2026-10-13 09:46:25')`);
		initSchema(old);
		expect(old.prepare(`select changed_on from walks`).get()).toMatchObject({
			changed_on: '2026-10-13'
		});
	});
});
