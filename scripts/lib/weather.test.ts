import { describe, expect, it } from 'vitest';
import { cellsOf, ensembleMasks, hourlyRain, type Hourly } from './weather';

const hoursOf = (date: string) =>
	Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`);

function ensemble(members: Record<string, (hour: number) => number | null>): Hourly {
	const time = hoursOf('2026-10-31');
	return {
		hourly: {
			time,
			...Object.fromEntries(
				Object.entries(members).map(([name, f]) => [name, time.map((_, h) => f(h))])
			)
		}
	} as Hourly;
}

describe('weather ingest', () => {
	it('finds cells a long straight stretch passes between its points', () => {
		// Two points in cells 0.5 apart: the one in between is passed without a point in it.
		expect(
			cellsOf(
				[
					[
						[5.0, 52.0],
						[5.5, 52.0]
					]
				],
				0.25
			)
		).toEqual(['52.00,5.00', '52.00,5.25', '52.00,5.50']);
	});

	it('marks a scenario’s wet hours from 06:00', () => {
		const masks = ensembleMasks(
			ensemble({
				precipitation: (h) => (h === 6 ? 0.3 : 0),
				precipitation_member01: (h) => (h === 22 ? 2 : 0.29)
			})
		).get('2026-10-31')!;
		expect([...masks]).toEqual([1, 1 << 16]);
	});

	it('ignores rain outside the forecast’s hours', () => {
		const masks = ensembleMasks(ensemble({ precipitation: (h) => (h < 6 || h > 22 ? 5 : 0) }));
		expect([...masks.get('2026-10-31')!]).toEqual([0]);
	});

	it('leaves out a date a scenario has no numbers for', () => {
		expect(
			ensembleMasks(ensemble({ precipitation: () => 0, precipitation_member01: () => null })).size
		).toBe(0);
	});

	it('reads the hourly rain, leaving out a date with gaps', () => {
		const time = [...hoursOf('2026-10-31'), ...hoursOf('2026-11-01')];
		const rain = hourlyRain({
			hourly: { time, precipitation: time.map((_, i) => (i < 24 ? i / 10 : null)) }
		} as Hourly);
		expect(rain.get('2026-10-31')?.slice(0, 2)).toEqual([0.6, 0.7]);
		expect(rain.get('2026-10-31')).toHaveLength(17);
		expect(rain.has('2026-11-01')).toBe(false);
	});
});
