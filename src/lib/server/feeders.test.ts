import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSchema } from './db';
import { feederRides, serviceTime } from './feeders';

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
			alight, dep, arr, stop_m) values ('w:1', 'end', ?, ?, 'Bus 136', 'Arriva', 'Den Bosch',
			'Drunen, Markt', 'Den Bosch, Station', ?, ?, 120)`
	);
	add.run(1, 'weekday', 16 * 3600, 16 * 3600 + 25 * 60);
	add.run(2, 'weekday', 15 * 3600, 15 * 3600 + 25 * 60);
	add.run(3, 'sunday', 17 * 3600, 17 * 3600 + 25 * 60);
	db.exec(`insert into feeder_service_date values ('weekday', '20261016'), ('sunday', '20261018')`);

	it("lists that day's rides by departure; null for an end without any", () => {
		const { start, end } = feederRides(db, 'w:1', '2026-10-16');
		expect(start).toBeNull();
		expect(end?.map((r) => r.departure)).toEqual([
			serviceTime('2026-10-16', 15 * 3600),
			serviceTime('2026-10-16', 16 * 3600)
		]);
		expect(end?.[0]).toMatchObject({ line: 'Bus 136', from: 'Drunen, Markt', stopM: 120 });
	});

	it('gives an empty list on a day without service', () => {
		expect(feederRides(db, 'w:1', '2026-10-17').end).toEqual([]);
	});
});
