/**
 * Rain forecasts for the cells the walks pass, from Open-Meteo (CC BY 4.0, free for non-commercial
 * use). Visitors never cause a call to it: this runs on a timer, the site reads what it stored.
 *
 * - ECMWF's ensemble (`ecmwf_ifs025`, 51 scenarios, 0.25°), for the chance of staying dry up to a
 *   week ahead. The model runs twice a day, so it's fetched when the last download is 11 hours old.
 * - KNMI's model (`knmi_seamless`, 2 km, 0.1° cells here), for the hour-by-hour bar on a walk's page
 *   for today and the two days after it: 2.5 days are KNMI's own, the rest ECMWF's.
 *
 * Only coordinates of grid cells are sent, and a generic User-Agent. A failed download keeps the
 * forecast from before it. The first ensemble download of each day is also archived, to check later
 * whether "70% dry" really was dry 70% of the time.
 */
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { LngLat } from '../../src/lib/geo';
import { openDb, transaction } from '../../src/lib/server/db';
import {
	encodeMasks,
	ENSEMBLE_DAYS_AHEAD,
	ENSEMBLE_STEP,
	HOURLY_DAYS_AHEAD,
	HOURLY_STEP
} from '../../src/lib/weather';
import { amsterdamYmd } from '../../src/lib/itinerary';
import { cellsOf, ensembleMasks, hourlyRain, type Hourly } from '../lib/weather';

const USER_AGENT = 'Treinwandelaar/0.1 (personal, non-commercial walk planner)';
const ENSEMBLE_URL = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ENSEMBLE_MAX_AGE_MS = 11 * 3600_000;

/**
 * A request costs per location, and the ensemble four times what a plain forecast does. The free limit
 * is 600 calls a minute: these batches and pauses stay near 360, also with the two forecasts in a row.
 */
const ENSEMBLE_BATCH = 30;
const HOURLY_BATCH = 100;
const PAUSE_MS = 20_000;
const FORCE = process.argv.includes('--force');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Several locations in one call: the answer is a list in the same order (one is a bare object). */
async function fetchBatch(url: string, cells: string[], params: string): Promise<Hourly[]> {
	const latitude = cells.map((c) => c.split(',')[0]).join(',');
	const longitude = cells.map((c) => c.split(',')[1]).join(',');
	const query = `latitude=${latitude}&longitude=${longitude}&timezone=Europe%2FAmsterdam&hourly=precipitation&${params}`;
	const response = await fetch(`${url}?${query}`, { headers: { 'user-agent': USER_AGENT } });
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${await response.text()}`);
	const body = (await response.json()) as Hourly | Hourly[];
	const list = Array.isArray(body) ? body : [body];
	if (list.length !== cells.length)
		throw new Error(`${url}: asked for ${cells.length} locations, got ${list.length}`);
	return list;
}

/** Every location of the batches, one result per cell, pausing between calls. */
async function fetchCells(
	url: string,
	cells: string[],
	batch: number,
	params: string
): Promise<Map<string, Hourly>> {
	const result = new Map<string, Hourly>();
	for (let i = 0; i < cells.length; i += batch) {
		if (i) await sleep(PAUSE_MS);
		const part = cells.slice(i, i + batch);
		const answers = await fetchBatch(url, part, params);
		part.forEach((cell, j) => result.set(cell, answers[j]));
	}
	return result;
}

/** All lines the site can plan on: the walks, and the routes you can cut your own stretches from. */
function allLines(db: DatabaseSync): LngLat[][] {
	const walks = db.prepare('select geometry from walks').all() as { geometry: string }[];
	const paths = db.prepare('select lines from paths').all() as { lines: string }[];
	return [
		...walks.map((w) => JSON.parse(w.geometry) as LngLat[]),
		...paths.flatMap((p) => JSON.parse(p.lines) as LngLat[][])
	];
}

async function refreshEnsemble(db: DatabaseSync, lines: LngLat[][], today: string) {
	const last = db.prepare('select max(fetched_at) as at from weather_ensemble').get() as {
		at: number | null;
	};
	if (!FORCE && last.at && Date.now() - last.at < ENSEMBLE_MAX_AGE_MS) {
		console.log('Ensemble: downloaded less than 11 hours ago, skipping');
		return;
	}
	const cells = cellsOf(lines, ENSEMBLE_STEP);
	const answers = await fetchCells(
		ENSEMBLE_URL,
		cells,
		ENSEMBLE_BATCH,
		`models=ecmwf_ifs025&forecast_days=${ENSEMBLE_DAYS_AHEAD + 1}`
	);
	const now = Date.now();
	const put = db.prepare(
		'insert or replace into weather_ensemble (date, cell, fetched_at, masks) values (?, ?, ?, ?)'
	);
	const archive = db.prepare(
		'insert or ignore into weather_ensemble_archive (issued_on, date, cell, masks) values (?, ?, ?, ?)'
	);
	let rows = 0;
	transaction(db, () => {
		db.prepare('delete from weather_ensemble').run();
		for (const [cell, answer] of answers)
			for (const [date, masks] of ensembleMasks(answer)) {
				if (date < today) continue;
				const blob = encodeMasks(masks);
				put.run(date, cell, now, blob);
				archive.run(today, date, cell, blob);
				rows++;
			}
	});
	console.log(`Ensemble: ${cells.length} cells, ${rows} cell-days`);
}

async function refreshHourly(db: DatabaseSync, lines: LngLat[][], today: string) {
	const cells = cellsOf(lines, HOURLY_STEP);
	const answers = await fetchCells(
		FORECAST_URL,
		cells,
		HOURLY_BATCH,
		`models=knmi_seamless&forecast_days=${HOURLY_DAYS_AHEAD + 1}`
	);
	const now = Date.now();
	const put = db.prepare(
		'insert or replace into weather_hourly (date, cell, fetched_at, mm) values (?, ?, ?, ?)'
	);
	let rows = 0;
	transaction(db, () => {
		db.prepare('delete from weather_hourly').run();
		for (const [cell, answer] of answers)
			for (const [date, mm] of hourlyRain(answer)) {
				if (date < today) continue;
				put.run(date, cell, now, JSON.stringify(mm));
				rows++;
			}
	});
	console.log(`Hourly: ${cells.length} cells, ${rows} cell-days`);
}

async function main() {
	const db = openDb();
	const lines = allLines(db);
	const today = amsterdamYmd();
	await refreshEnsemble(db, lines, today);
	await sleep(PAUSE_MS);
	await refreshHourly(db, lines, today);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	main().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
