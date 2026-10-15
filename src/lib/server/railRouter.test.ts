import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSchema } from './db';
import {
	buildDay,
	fastestRoutes,
	fastestRoutesHome,
	timetableLastDay,
	TRANSFER_SECONDS
} from './railRouter';

const t = (hm: string) => {
	const [h, m] = hm.split(':').map(Number);
	return h * 3600 + m * 60;
};
type Stop = [code: string, arr: string, dep?: string];
let nextTrip = 1;
const trip = (name: string, stops: Stop[]) => {
	const id = nextTrip++;
	return stops.map(([code, arr, dep]) => ({
		trip_id: id,
		code,
		arr: t(arr),
		dep: t(dep ?? arr),
		name
	}));
};

describe('rail router (connection scan)', () => {
	// A ─ B ─ C by Sprinter; a faster Intercity A ─ C later; a branch B ─ D needing a change at B.
	const rows = [
		...trip('Sprinter', [
			['A', '08:00'],
			['B', '08:20'],
			['C', '08:40']
		]),
		...trip('Intercity', [
			['A', '08:30'],
			['C', '08:50']
		]),
		...trip('Stoptrein', [
			['B', '08:22'], // only 2 minutes after the Sprinter arrives: too tight
			['D', '08:40']
		]),
		...trip('Stoptrein', [
			['B', '08:25'],
			['D', '08:43']
		])
	];
	const day = buildDay(rows);
	const routes = fastestRoutes(day, 'A', ['B', 'C', 'D', 'A'], {
		fromTime: t('07:45'),
		toTime: t('09:00')
	});

	it('measures from the first train, so waiting at home does not count', () => {
		expect(routes.get('C')).toMatchObject({ minutes: 20, transfers: 0, legs: ['Intercity'] });
	});

	it('needs the transfer time to change trains, but not to stay on board', () => {
		expect(TRANSFER_SECONDS).toBe(180);
		expect(routes.get('D')).toMatchObject({
			minutes: 43,
			transfers: 1,
			legs: ['Sprinter', 'Stoptrein']
		});
		expect(routes.get('B')?.minutes).toBe(20);
	});

	it('lists every stretch travelled, for matching disruptions', () => {
		expect(routes.get('D')?.edges).toEqual(
			expect.arrayContaining([
				['A', 'B'],
				['B', 'D']
			])
		);
		expect(routes.get('A')).toMatchObject({ minutes: 0, edges: [] });
	});

	it('returns null for unreachable or unknown stations', () => {
		const r = fastestRoutes(day, 'C', ['A', 'XX']);
		expect(r.get('A')).toBeNull();
		expect(r.get('XX')).toBeNull();
	});

	it('plans the actual trip home, which need not mirror the way out', () => {
		// Afternoon: from D back to A a direct Intercity D → A beats changing at B.
		const back = buildDay([
			...trip('Stoptrein', [
				['D', '16:00'],
				['B', '16:18']
			]),
			...trip('Sprinter', [
				['B', '16:25'],
				['A', '16:45']
			]),
			...trip('Intercity', [
				['D', '16:30'],
				['A', '16:58']
			])
		]);
		const home = fastestRoutesHome(back, 'A', ['D', 'B', 'A'], {
			fromTime: t('16:30'),
			toTime: t('17:30')
		});
		expect(home.get('D')).toMatchObject({ minutes: 28, transfers: 0, legs: ['Intercity'] });
		expect(home.get('D')?.edges).toEqual([['D', 'A']]);
		expect(home.get('B')).toMatchObject({ minutes: 20, legs: ['Sprinter'] });
		expect(home.get('A')?.minutes).toBe(0);
	});

	it('needs the transfer time on the way home too', () => {
		const back = buildDay([
			...trip('Stoptrein', [
				['D', '16:00'],
				['B', '16:23']
			]),
			...trip('Sprinter', [
				['B', '16:25'], // 2 minutes: too tight
				['A', '16:45']
			]),
			...trip('Sprinter', [
				['B', '16:40'],
				['A', '17:00']
			])
		]);
		const home = fastestRoutesHome(back, 'A', ['D'], { fromTime: t('16:00'), toTime: t('17:30') });
		expect(home.get('D')).toMatchObject({ minutes: 60, transfers: 1 });
		expect(home.get('D')?.edges).toEqual([
			['D', 'B'],
			['B', 'A']
		]);
	});
});

describe('timetableLastDay', () => {
	it('is the last service date, as YYYY-MM-DD', () => {
		const db = new DatabaseSync(':memory:');
		initSchema(db);
		const add = db.prepare('insert into gtfs_service_date (service_id, date) values (?, ?)');
		add.run('a', '20261013');
		add.run('a', '20261212');
		add.run('b', '20261101');
		expect(timetableLastDay(db)).toBe('2026-12-12');
	});

	it('is null without a timetable', () => {
		const db = new DatabaseSync(':memory:');
		initSchema(db);
		expect(timetableLastDay(db)).toBeNull();
	});
});
