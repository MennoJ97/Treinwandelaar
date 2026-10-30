import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { decodeMasks, encodeMasks } from '../weather';
import { initSchema } from './db';
import { dayForecast, MAX_AGE_MS } from './weather';

const NOW = 1_800_000_000_000;

describe('dayForecast', () => {
	let db: DatabaseSync;

	const putEnsemble = (date: string, at: number) =>
		db
			.prepare('insert into weather_ensemble (date, cell, fetched_at, masks) values (?, ?, ?, ?)')
			.run(date, '52.00,5.00', at, encodeMasks(Uint32Array.from([3, 0])));
	const putHourly = (date: string, at: number) =>
		db
			.prepare('insert into weather_hourly (date, cell, fetched_at, mm) values (?, ?, ?, ?)')
			.run(date, '52.00,5.00', at, '[0.5]');

	beforeEach(() => {
		db = new DatabaseSync(':memory:');
		initSchema(db);
	});

	it('answers with the masks and hours of that day', () => {
		putEnsemble('2026-10-31', NOW);
		putHourly('2026-10-31', NOW);
		putEnsemble('2026-11-01', NOW);
		const r = dayForecast(db, '2026-10-31', NOW)!;
		expect(r.fetchedAt).toBe(NOW);
		expect([...decodeMasks(r.ensemble['52.00,5.00'])]).toEqual([3, 0]);
		expect(r.hourly).toEqual({ '52.00,5.00': [0.5] });
	});

	it('still ranks when the hourly forecast is beyond its days', () => {
		putEnsemble('2026-11-05', NOW);
		expect(dayForecast(db, '2026-11-05', NOW)?.hourly).toEqual({});
	});

	it('has nothing for a day without a forecast', () => {
		expect(dayForecast(db, '2026-10-31', NOW)).toBeNull();
	});

	it('hides a stale forecast', () => {
		putEnsemble('2026-10-31', NOW - MAX_AGE_MS - 1);
		expect(dayForecast(db, '2026-10-31', NOW)).toBeNull();
	});

	it('drops a stale hourly forecast but keeps a fresh ensemble', () => {
		putEnsemble('2026-10-31', NOW);
		putHourly('2026-10-31', NOW - MAX_AGE_MS - 1);
		expect(dayForecast(db, '2026-10-31', NOW)?.hourly).toEqual({});
	});
});
