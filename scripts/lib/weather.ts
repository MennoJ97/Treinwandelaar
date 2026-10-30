/** Reading Open-Meteo's forecasts into what src/lib/weather.ts scores: see scripts/ingest/weather.ts. */
import { haversine, type LngLat } from '../../src/lib/geo';
import { cellKey, FIRST_HOUR, HOURS, LAST_HOUR, WET_MM } from '../../src/lib/weather';

/** Simplified lines can have long straight stretches; a cell passed between two points still counts. */
const SAMPLE_M = 1000;

/** Every grid cell these lines pass through, sorted. */
export function cellsOf(lines: LngLat[][], step: number): string[] {
	const cells = new Set<string>();
	for (const line of lines) {
		line.forEach((point, i) => {
			cells.add(cellKey(point, step));
			const next = line[i + 1];
			if (!next) return;
			const parts = Math.ceil(haversine(point, next) / SAMPLE_M);
			for (let p = 1; p < parts; p++)
				cells.add(
					cellKey(
						[
							point[0] + ((next[0] - point[0]) * p) / parts,
							point[1] + ((next[1] - point[1]) * p) / parts
						],
						step
					)
				);
		});
	}
	return [...cells].sort();
}

/** Open-Meteo's answer for one location. */
export interface Hourly {
	hourly: { time: string[] } & Record<string, (number | null)[] | string[]>;
}

/** The hours of each date in the forecast's hours, as indexes into `time`; only complete dates. */
function daysIn(time: string[]): Map<string, number[]> {
	const days = new Map<string, number[]>();
	time.forEach((t, i) => {
		const hour = Number(t.slice(11, 13));
		if (hour < FIRST_HOUR || hour > LAST_HOUR) return;
		const date = t.slice(0, 10);
		days.set(date, [...(days.get(date) ?? []), i]);
	});
	for (const [date, hours] of days) if (hours.length !== HOURS) days.delete(date);
	return days;
}

/**
 * Per date, each scenario's wet hours as a mask. A date any scenario has no numbers for is left out:
 * past the model's horizon the API answers null, and a missing scenario would pass for a dry one.
 */
export function ensembleMasks(location: Hourly): Map<string, Uint32Array> {
	const { time, ...series } = location.hourly;
	const members = Object.keys(series)
		.filter((k) => k.startsWith('precipitation'))
		.map((k) => series[k] as (number | null)[]);
	const result = new Map<string, Uint32Array>();
	if (!members.length) return result;
	for (const [date, hours] of daysIn(time)) {
		const masks = new Uint32Array(members.length);
		const complete = members.every((values, m) =>
			hours.every((index, h) => {
				const mm = values[index];
				if (mm == null) return false;
				if (mm >= WET_MM) masks[m] |= 1 << h;
				return true;
			})
		);
		if (complete) result.set(date, masks);
	}
	return result;
}

/** Per date, the mm per hour from FIRST_HOUR. */
export function hourlyRain(location: Hourly): Map<string, number[]> {
	const { time, precipitation } = location.hourly;
	const values = (precipitation ?? []) as (number | null)[];
	const result = new Map<string, number[]>();
	for (const [date, hours] of daysIn(time)) {
		const mm = hours.map((i) => values[i]);
		if (mm.every((v) => v != null)) result.set(date, mm as number[]);
	}
	return result;
}
