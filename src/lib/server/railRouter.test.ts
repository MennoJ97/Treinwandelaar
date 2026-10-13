import { describe, expect, it } from 'vitest';
import { buildDay, fastestRoutes, TRANSFER_SECONDS } from './railRouter';

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
});
