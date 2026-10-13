/**
 * Load the Dutch rail timetable from OVapi's GTFS feed into SQLite, for the offline travel-time map.
 *
 * The feed (gtfs.ovapi.nl/nl/gtfs-nl.zip, ~250 MB, rebuilt daily) covers all public transport for
 * about two months, including planned engineering works. We keep only the rail operators (agency
 * "IFF:*", from the national rail timetable): trains, plus their replacement buses where those stop
 * at stations. Rail stops carry the NS station code in zone_id ("IFF:ut" → UT).
 *
 * The zip is only re-downloaded when OVapi has a newer one; stop_times.txt (1.2 GB unpacked) is
 * streamed out of it, never written to disk. Tables are swapped in one transaction.
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { openDb, transaction } from '../../src/lib/server/db';
import { gtfsTime, parseCsvLine } from '../lib/csv';

const FEED_URL = 'https://gtfs.ovapi.nl/nl/gtfs-nl.zip';
const ZIP_PATH =
	process.env.GTFS_ZIP ?? `${dirname(process.env.DATABASE_PATH ?? 'data/x')}/gtfs/gtfs-nl.zip`;
const USER_AGENT = 'Treinwandelaar/0.1 (personal, non-commercial walk planner)';
/** Sleeper trains need reservations and don't help a day trip. */
const SKIP_AGENCIES = new Set(['IFF:EU_SLEEPER']);

async function download(): Promise<boolean> {
	mkdirSync(dirname(ZIP_PATH), { recursive: true });
	const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
	if (existsSync(ZIP_PATH) && !process.argv.includes('--refresh'))
		headers['If-Modified-Since'] = statSync(ZIP_PATH).mtime.toUTCString();
	const res = await fetch(FEED_URL, { headers });
	if (res.status === 304) return false;
	if (!res.ok || !res.body) throw new Error(`GTFS download failed: ${res.status}`);
	const tmp = `${ZIP_PATH}.part`;
	await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
	renameSync(tmp, ZIP_PATH);
	return true;
}

/** Calls `onRow` for every row of one file in the zip, streamed. */
function eachRow(
	zipPath: string,
	file: string,
	onRow: (row: Record<string, string>) => void
): Promise<void> {
	return new Promise((resolve, reject) => {
		yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
			if (err || !zip) return reject(err);
			zip.on('entry', (entry: yauzl.Entry) => {
				if (entry.fileName !== file) return zip.readEntry();
				zip.openReadStream(entry, async (err2, stream) => {
					if (err2 || !stream) return reject(err2);
					let header: string[] | null = null;
					try {
						for await (const raw of createInterface({ input: stream, crlfDelay: Infinity })) {
							const line = raw.replace(/^﻿/, '');
							if (!line) continue;
							const fields = parseCsvLine(line);
							if (!header) {
								header = fields;
								continue;
							}
							const row: Record<string, string> = {};
							header.forEach((h, i) => (row[h] = fields[i] ?? ''));
							onRow(row);
						}
						zip.close();
						resolve();
					} catch (e) {
						reject(e);
					}
				});
			});
			zip.on('end', () => reject(new Error(`${file} not in ${zipPath}`)));
			zip.readEntry();
		});
	});
}

async function main() {
	const fresh = await download();
	console.log(fresh ? 'Downloaded a new feed.' : 'Feed unchanged since last download.');
	const db = openDb();
	const feedDate = statSync(ZIP_PATH).mtime.toISOString();
	const loaded = db.prepare(`select value from meta where key = 'gtfs_feed_date'`).get() as
		{ value: string } | undefined;
	if (!fresh && loaded?.value === feedDate && !process.argv.includes('--reload')) {
		console.log('Timetable already loaded from this feed.');
		return;
	}

	const t0 = Date.now();
	const railRoutes = new Map<string, string>(); // route_id → display name
	await eachRow(ZIP_PATH, 'routes.txt', (r) => {
		if (!r.agency_id.startsWith('IFF:') || SKIP_AGENCIES.has(r.agency_id)) return;
		if (r.route_type !== '2' && r.route_type !== '3') return;
		const name = r.route_type === '3' ? 'Bus' : r.route_short_name || 'Trein';
		railRoutes.set(r.route_id, name);
	});

	const trips = new Map<string, { service: string; name: string }>();
	await eachRow(ZIP_PATH, 'trips.txt', (r) => {
		const name = railRoutes.get(r.route_id);
		if (name) trips.set(r.trip_id, { service: r.service_id, name });
	});
	const services = new Set([...trips.values()].map((t) => t.service));

	const stopCode = new Map<string, string>();
	await eachRow(ZIP_PATH, 'stops.txt', (r) => {
		if (r.zone_id?.startsWith('IFF:')) stopCode.set(r.stop_id, r.zone_id.slice(4).toUpperCase());
	});

	const serviceDates: [string, string][] = [];
	await eachRow(ZIP_PATH, 'calendar_dates.txt', (r) => {
		if (r.exception_type === '1' && services.has(r.service_id))
			serviceDates.push([r.service_id, r.date]);
	});

	const stopTimes: [number, number, string, number, number][] = [];
	let skipped = 0;
	await eachRow(ZIP_PATH, 'stop_times.txt', (r) => {
		if (!trips.has(r.trip_id)) return;
		const code = stopCode.get(r.stop_id);
		if (!code) return void skipped++; // replacement-bus stop that isn't a station
		stopTimes.push([
			Number(r.trip_id),
			Number(r.stop_sequence),
			code,
			gtfsTime(r.arrival_time),
			gtfsTime(r.departure_time)
		]);
	});

	transaction(db, () => {
		db.exec('delete from gtfs_stop_time; delete from gtfs_trip; delete from gtfs_service_date;');
		const insDate = db.prepare(
			'insert or ignore into gtfs_service_date (service_id, date) values (?, ?)'
		);
		for (const [s, d] of serviceDates) insDate.run(s, d);
		const insTrip = db.prepare(
			'insert into gtfs_trip (trip_id, service_id, name) values (?, ?, ?)'
		);
		for (const [id, t] of trips) insTrip.run(Number(id), t.service, t.name);
		const insStop = db.prepare(
			'insert or replace into gtfs_stop_time (trip_id, seq, code, arr, dep) values (?, ?, ?, ?, ?)'
		);
		for (const st of stopTimes) insStop.run(...st);
		const setMeta = db.prepare('insert or replace into meta (key, value) values (?, ?)');
		setMeta.run('gtfs_feed_date', feedDate);
		setMeta.run('gtfs_loaded_at', new Date().toISOString());
	});

	const dates = serviceDates.map(([, d]) => d).sort();
	console.log(
		`Loaded ${trips.size} rail trips, ${stopTimes.length} stops (${skipped} non-station bus stops skipped), ` +
			`${dates[0]}–${dates.at(-1)}, in ${((Date.now() - t0) / 1000).toFixed(0)} s.`
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
