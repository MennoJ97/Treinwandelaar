import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSchema } from './db';
import { deleteSavedTrip, listSavedTrips, saveTrip } from './savedTrips';

function freshDb() {
	const db = new DatabaseSync(':memory:');
	db.exec('pragma foreign_keys = on');
	initSchema(db);
	const add = db.prepare(
		`insert into walks (id, source, source_id, collection, name, distance_km, geometry, source_url,
			updated_at) values (?, ?, ?, 'ns-wandeling', ?, 12, '[[5,52],[5.1,52.1]]', 'https://example.org/1',
			'2026-10-13')`
	);
	add.run('w:1', 'wandelnet', '1', 'Langs de Lek');
	add.run('osm:2', 'osm', '2', 'Over de Heuvelrug');
	return db;
}

const plan = { date: '2026-10-31', time: '09:00', out: '09:09', back: '16:42' };

describe('saved trips', () => {
	it("keeps one user's trips away from another, soonest first", () => {
		const db = freshDb();
		saveTrip(db, 'menno', 'osm:2', false, { ...plan, date: '2026-11-07' });
		saveTrip(db, 'menno', 'w:1', true, plan);
		saveTrip(db, 'bilge', 'w:1', false, { ...plan, out: null, back: null });

		expect(listSavedTrips(db, 'menno')).toEqual([
			{ walkId: 'w:1', walkName: 'Langs de Lek', reversed: true, ...plan },
			{
				walkId: 'osm:2',
				walkName: 'Over de Heuvelrug',
				reversed: false,
				...plan,
				date: '2026-11-07'
			}
		]);
		expect(listSavedTrips(db, 'bilge')).toMatchObject([{ walkId: 'w:1', out: null, back: null }]);
	});

	it('replaces the plan for the same walk and date, and deletes it', () => {
		const db = freshDb();
		saveTrip(db, 'menno', 'w:1', false, plan);
		saveTrip(db, 'menno', 'w:1', false, { ...plan, out: '09:24' });
		expect(listSavedTrips(db, 'menno')).toMatchObject([{ out: '09:24' }]);

		deleteSavedTrip(db, 'menno', 'w:1', plan.date);
		expect(listSavedTrips(db, 'menno')).toEqual([]);
	});

	it('goes when its walk goes', () => {
		const db = freshDb();
		saveTrip(db, 'menno', 'w:1', false, plan);
		db.prepare('delete from walks where id = ?').run('w:1');
		expect(listSavedTrips(db, 'menno')).toEqual([]);
	});
});
