import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSchema, LOCAL_USER } from './db';
import { getWalk, listWalks, publicWalks, updateUserWalk, walkLines } from './walks';

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
