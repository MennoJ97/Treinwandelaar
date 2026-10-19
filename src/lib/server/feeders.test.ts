import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSchema } from './db';
import { feederKeys, feederRides, serviceTime } from './feeders';

describe('serviceTime', () => {
	it('turns GTFS seconds into Amsterdam time, summer and winter', () => {
		expect(new Date(serviceTime('2026-10-17', 15 * 3600 + 42 * 60)).toISOString()).toBe(
			'2026-10-17T13:42:00.000Z'
		);
		expect(new Date(serviceTime('2026-11-14', 15 * 3600 + 42 * 60)).toISOString()).toBe(
			'2026-11-14T14:42:00.000Z'
		);
	});
});

describe('feederRides', () => {
	const db = new DatabaseSync(':memory:');
	initSchema(db);
	const add = db.prepare(
		`insert into feeder_trip (walk_id, side, trip_id, service_id, line, operator, headsign, board,
			alight, dep, arr, stop_m, geometry_id) values ('w:1', 'end', ?, ?, 'Bus 136', 'Arriva',
			'Den Bosch', 'Drunen, Markt', 'Den Bosch, Station', ?, ?, 120, ?)`
	);
	add.run(1, 'weekday', 16 * 3600, 16 * 3600 + 25 * 60, 7);
	add.run(2, 'weekday', 15 * 3600, 15 * 3600 + 25 * 60, null);
	add.run(3, 'sunday', 17 * 3600, 17 * 3600 + 25 * 60, 7);
	db.exec(`insert into feeder_service_date values ('weekday', '20261016'), ('sunday', '20261018')`);
	db.exec(`insert into feeder_geometry values (7, '[[5.18,51.68],[5.29,51.69]]')`);

	it("lists that day's rides by departure; null for an end without any", () => {
		const { start, end } = feederRides(db, 'w:1', '2026-10-16');
		expect(start).toBeNull();
		expect(end?.map((r) => r.departure)).toEqual([
			serviceTime('2026-10-16', 15 * 3600),
			serviceTime('2026-10-16', 16 * 3600)
		]);
		expect(end?.[0]).toMatchObject({ line: 'Bus 136', from: 'Drunen, Markt', stopM: 120 });
	});

	it('gives each ride the way it runs, if known', () => {
		const { end } = feederRides(db, 'w:1', '2026-10-16');
		expect(end?.map((r) => r.geometry)).toEqual([
			[],
			[
				[5.18, 51.68],
				[5.29, 51.69]
			]
		]);
	});

	it('gives an empty list on a day without service', () => {
		expect(feederRides(db, 'w:1', '2026-10-17').end).toEqual([]);
	});
});

describe('initSchema', () => {
	it('gives an older database the rides’ geometry', () => {
		const old = new DatabaseSync(':memory:');
		old.exec(`create table feeder_trip (walk_id text not null, side text not null,
			trip_id integer not null, service_id text not null, line text not null, operator text,
			headsign text, board text not null, alight text not null, dep integer not null,
			arr integer not null, stop_m integer not null, primary key (walk_id, side, trip_id)
		) without rowid`);
		initSchema(old);
		const columns = old.prepare('pragma table_info(feeder_trip)').all() as { name: string }[];
		expect(columns.map((c) => c.name)).toContain('geometry_id');
		expect(feederRides(old, 'w:1', '2026-10-16')).toEqual({ start: null, end: null });
	});
});

describe('feederKeys', () => {
	it('keeps a walk’s own rides under its own id', () => {
		expect(feederKeys('wandelnet:123')).toEqual({ start: 'wandelnet:123', end: 'wandelnet:123' });
		expect(feederKeys('pad:pieterpad-deel-1:GN-HRN').end).toBe('pad:pieterpad-deel-1:GN-HRN');
	});

	it('takes a stage end’s rides for a stretch that starts or ends there', () => {
		expect(feederKeys('pad:pieterpad-deel-1:e2-e4')).toEqual({
			start: 'pad:pieterpad-deel-1:e2',
			end: 'pad:pieterpad-deel-1:e4'
		});
		expect(feederKeys('pad:pieterpad-deel-1:GN-e3').end).toBe('pad:pieterpad-deel-1:e3');
	});

	it('turned around, takes the rides stored for the other way', () => {
		expect(feederKeys('wandelnet:123', true)).toEqual({
			start: 'reverse:wandelnet:123',
			end: 'reverse:wandelnet:123'
		});
	});

	it('turned around, swaps a stretch’s stage ends, which have rides both ways', () => {
		expect(feederKeys('pad:pieterpad-deel-1:e2-e4', true)).toEqual({
			start: 'pad:pieterpad-deel-1:e4',
			end: 'pad:pieterpad-deel-1:e2'
		});
		expect(feederKeys('pad:pieterpad-deel-1:GN-e3', true).start).toBe('pad:pieterpad-deel-1:e3');
	});
});
