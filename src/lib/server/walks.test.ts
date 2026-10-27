import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSchema, LOCAL_USER } from './db';
import {
	getWalk,
	listWalks,
	publicWalks,
	relatedWalks,
	updateUserWalk,
	walkLines,
	withStages
} from './walks';

function addWalk(db: DatabaseSync, id: string, source: string, collection: string, duplicate = 0) {
	db.prepare(
		`insert into walks (id, source, source_id, collection, name, distance_km, geometry, source_url,
			wandelnet_duplicate, updated_at) values (?, ?, ?, ?, 'Proefwandeling', 12,
			'[[5,52],[5.1,52.1]]', 'https://example.org/1', ?, '2026-10-13')`
	).run(id, source, id, collection, duplicate);
}

function withWalk(db: DatabaseSync) {
	addWalk(db, 'w:1', 'wandelnet', 'ns-wandeling');
	return db;
}

const freshDb = () => {
	const db = new DatabaseSync(':memory:');
	initSchema(db);
	return withWalk(db);
};

describe('personal layer per user', () => {
	it("keeps one user's status, rating and notes away from another", () => {
		const db = freshDb();
		updateUserWalk(db, 'menno', 'w:1', { status: 'done', ownRating: 4, notes: 'Mooi' });
		updateUserWalk(db, 'bilge', 'w:1', { status: 'wishlist' });

		expect(getWalk(db, 'w:1', 'menno')).toMatchObject({
			status: 'done',
			ownRating: 4,
			notes: 'Mooi'
		});
		expect(getWalk(db, 'w:1', 'bilge')).toMatchObject({
			status: 'wishlist',
			ownRating: null,
			notes: null
		});
		expect(listWalks(db, 'someone-else')[0]).toMatchObject({ status: null, ownRating: null });
	});

	it('updates only the fields that are sent', () => {
		const db = freshDb();
		updateUserWalk(db, 'menno', 'w:1', { status: 'wishlist', notes: 'Met de hond' });
		updateUserWalk(db, 'menno', 'w:1', { ownRating: 5 });
		expect(getWalk(db, 'w:1', 'menno')).toMatchObject({
			status: 'wishlist',
			ownRating: 5,
			notes: 'Met de hond'
		});
	});

	it('marks a walk done on the day given, else keeps the day it was first marked', () => {
		const db = freshDb();
		const doneDate = () =>
			(
				db.prepare('select done_date from user_walk where walk_id = ?').get('w:1') as {
					done_date: string | null;
				}
			).done_date;
		updateUserWalk(db, 'menno', 'w:1', { status: 'done', doneDate: '2026-10-31' });
		expect(doneDate()).toBe('2026-10-31');
		updateUserWalk(db, 'menno', 'w:1', { ownRating: 4 });
		expect(doneDate()).toBe('2026-10-31');
		updateUserWalk(db, 'menno', 'w:1', { status: null });
		expect(doneDate()).toBeNull();
	});

	it('moves single-user rows from older databases to the local user', () => {
		const db = freshDb();
		db.exec(`drop table user_walk;
			create table user_walk (walk_id text primary key references walks(id) on delete cascade,
				status text, own_rating integer, notes text, done_date text);
			insert into user_walk values ('w:1', 'done', 3, 'Oud', '2026-09-01');`);
		initSchema(db); // as on the next start

		expect(getWalk(db, 'w:1', LOCAL_USER)).toMatchObject({
			status: 'done',
			ownRating: 3,
			notes: 'Oud'
		});
		expect(getWalk(db, 'w:1', 'menno')).toMatchObject({ status: null });
	});
});

describe('demo visibility', () => {
	const db = freshDb();
	addWalk(db, 'osm:law', 'osm', 'law');
	addWalk(db, 'osm:lokaal', 'osm', 'lokaal');
	addWalk(db, 'osm:copy', 'osm', 'law', 1);
	addWalk(db, 'pad:law', 'wandelnet', 'law');
	const ids = (user: string | null) =>
		listWalks(db, user)
			.map((w) => w.id)
			.sort();

	it('shows anonymous visitors only the OpenStreetMap walks', () => {
		expect(ids(null)).toEqual(['osm:copy', 'osm:law', 'osm:lokaal']);
		expect(getWalk(db, 'w:1', null)).toBeNull();
		expect(getWalk(db, 'pad:law', null)).toBeNull();
		expect(getWalk(db, 'osm:law', null)).toMatchObject({ source: 'osm', status: null });
	});

	it("gives signed-in users everything but OSM's copies of Wandelnet walks", () => {
		expect(ids('menno')).toEqual(['osm:law', 'osm:lokaal', 'pad:law', 'w:1']);
	});
});

describe('public pages', () => {
	const db = freshDb();
	addWalk(db, 'osm:law', 'osm', 'law');
	addWalk(db, 'osm:copy', 'osm', 'law', 1);
	addWalk(db, 'pad:law', 'wandelnet', 'law');

	it('lists only OpenStreetMap walks in the sitemap, with the day their data changed', () => {
		db.prepare(`update walks set changed_on = '2026-10-12' where id = 'osm:law'`).run();
		expect(publicWalks(db)).toEqual([
			{ id: 'osm:copy', changedOn: null },
			{ id: 'osm:law', changedOn: '2026-10-12' }
		]);
	});

	it('sends the lines of the walks the viewer may see, and only those', () => {
		expect(Object.keys(JSON.parse(walkLines(db, null))).sort()).toEqual(['osm:copy', 'osm:law']);
		expect(JSON.parse(walkLines(db, 'menno'))['pad:law']).toEqual([
			[5, 52],
			[5.1, 52.1]
		]);
		expect(listWalks(db, null)[0]).not.toHaveProperty('geometry');
	});

	it('has no page for a stretch planned on request', () => {
		expect(getWalk(db, 'osm:law', null, { planned: false })).toMatchObject({ id: 'osm:law' });
		expect(getWalk(db, 'osm:nopath:UT-GD', null, { planned: false })).toBeNull();
	});
});

describe("a path's stages", () => {
	const db = freshDb();
	db.exec(`insert into stations (code, name, lat, lng) values ('A', 'Aa', 52, 5), ('B', 'Bee', 52, 5.1),
		('C', 'Cee', 52, 5.2), ('D', 'Dee', 52, 5.3)`);
	db.prepare(
		`insert into paths (id, source, collection, name, km, lines, stops, stages, source_url, updated_at)
		 values ('osm:pad', 'osm', 'law', 'Proefpad', 30, '[]', ?, '[]', 'u', '2026-10-19')`
	).run(
		JSON.stringify(
			['A', 'B', 'C', 'D'].map((code, i) => ({ key: code, code, line: 0, km: i * 10 }))
		)
	);
	for (const id of ['osm:pad:C-D', 'osm:pad:A-B', 'osm:pad:B-C']) addWalk(db, id, 'osm', 'law');
	const stage = (id: string) => getWalk(db, id, null)!;

	it("follow the path's own stages where no day walk joins on", () => {
		const db = freshDb();
		db.exec(`insert into stations (code, name, lat, lng) values ('A', 'Aa', 52, 5), ('B', 'Bee', 52, 5.1),
			('C', 'Cee', 52, 5.2), ('D', 'Dee', 52, 5.3)`);
		const line = Array.from({ length: 31 }, (_, i) => [5 + i / 100, 52]);
		db.prepare(
			`insert into paths (id, source, collection, name, km, lines, stops, stages, source_url, updated_at)
			 values ('pad:x', 'wandelnet', 'law', 'Proefpad', 20, ?, ?, ?, 'u', '2026-10-19')`
		).run(
			JSON.stringify([line]),
			JSON.stringify(
				['A', 'B', 'C', 'D'].map((code, i) => ({
					key: code,
					code,
					name: code,
					place: null,
					line: 0,
					index: i * 10,
					km: i * 6.9,
					metres: 100
				}))
			),
			JSON.stringify(
				[
					[0, 6.9],
					[6.9, 20.7]
				].map(([fromKm, toKm], n) => ({
					number: n + 1,
					places: null,
					url: 'u',
					line: 0,
					fromKm,
					toKm
				}))
			)
		);
		// A–B is stage 1; the stage after it ends at D, so the next stretch is B–D. Backwards from C, A.
		const ab = withStages(db, getWalk(db, 'pad:x:A-B', 'menno')!, 'menno').stages!;
		expect([ab.prev, ab.next?.id]).toEqual([null, 'pad:x:B-D']);
		const cb = withStages(db, getWalk(db, 'pad:x:C-B', 'menno')!, 'menno').stages!;
		expect(cb.next?.id).toBe('pad:x:B-A');
	});

	it('come in path order, with the stages before and after', () => {
		const r = relatedWalks(db, stage('osm:pad:B-C'), null);
		expect(r.path).toEqual({ id: 'osm:pad', name: 'Proefpad' });
		expect(r.stages.map((w) => w.id)).toEqual(['osm:pad:A-B', 'osm:pad:C-D']);
		expect(r.prev?.id).toBe('osm:pad:A-B');
		expect(r.next?.id).toBe('osm:pad:C-D');
		expect(relatedWalks(db, stage('osm:pad:A-B'), null)).toMatchObject({ prev: null });
	});
});
