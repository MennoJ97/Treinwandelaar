import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSchema, LOCAL_USER } from './db';
import { getWalk, listWalks, updateUserWalk } from './walks';

function withWalk(db: DatabaseSync) {
	db.exec(`insert into walks (id, source, source_id, collection, name, distance_km, geometry, source_url,
		updated_at) values ('w:1', 'w', '1', 'ns-wandeling', 'Proefwandeling', 12, '[[5,52],[5.1,52.1]]',
		'https://example.org/1', '2026-10-13')`);
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
