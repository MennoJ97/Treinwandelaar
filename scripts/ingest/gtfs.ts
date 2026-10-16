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
 *
 * From the other operators we take only the feeder rides: buses, trams, metros and ferries between
 * route ends too far from a station to walk and that station (see ../lib/feeders.ts). Those depend on
 * the walks, so run this after the walk ingests; it reloads them whenever the walks' ends change.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import type { DatabaseSync } from 'node:sqlite';
import type { LngLat } from '../../src/lib/geo';
import { openDb, transaction } from '../../src/lib/server/db';
import { WALKABLE_STATION_M } from '../../src/lib/types';
import { gtfsTime, parseCsvLine } from '../lib/csv';
import {
	ROUTE_STOP_M,
	STATION_STOP_M,
	feederRide,
	isFeederMode,
	lineName,
	stopsNear,
	type FeederEnd,
	type Stop,
	type StopTime
} from '../lib/feeders';

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
	const reload = process.argv.includes('--reload');
	const loaded = db.prepare(`select value from meta where key = 'gtfs_feed_date'`).get() as
		{ value: string } | undefined;
	if (!fresh && loaded?.value === feedDate && !reload)
		console.log('Timetable already loaded from this feed.');
	else await loadRail(db, feedDate);
	await loadFeeders(db, feedDate, reload);
}

async function loadRail(db: DatabaseSync, feedDate: string) {
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

/** Every route end too far from its station to walk, with both points. */
function feederEnds(db: DatabaseSync): FeederEnd[] {
	const rows = db
		.prepare(
			`select w.id, w.geometry, w.start_station_m, w.end_station_m,
				s1.lng as s1_lng, s1.lat as s1_lat, s2.lng as s2_lng, s2.lat as s2_lat
			 from walks w
			 left join stations s1 on s1.code = w.start_station
			 left join stations s2 on s2.code = w.end_station
			 where w.start_station_m > ? or w.end_station_m > ?
			 order by w.id`
		)
		.all(WALKABLE_STATION_M, WALKABLE_STATION_M) as {
		id: string;
		geometry: string;
		start_station_m: number | null;
		end_station_m: number | null;
		s1_lng: number | null;
		s1_lat: number | null;
		s2_lng: number | null;
		s2_lat: number | null;
	}[];
	const ends: FeederEnd[] = [];
	for (const r of rows) {
		const line = JSON.parse(r.geometry) as LngLat[];
		if ((r.start_station_m ?? 0) > WALKABLE_STATION_M && r.s1_lng != null && r.s1_lat != null)
			ends.push({ walkId: r.id, side: 'start', route: line[0], station: [r.s1_lng, r.s1_lat] });
		if ((r.end_station_m ?? 0) > WALKABLE_STATION_M && r.s2_lng != null && r.s2_lat != null)
			ends.push({ walkId: r.id, side: 'end', route: line.at(-1)!, station: [r.s2_lng, r.s2_lat] });
	}
	return ends;
}

/**
 * Feeder rides for every far route end. Streams stop_times once more, keeping only the stops near
 * those ends and stations (a few hundred of the ~60k), then pairs them up per trip.
 */
async function loadFeeders(db: DatabaseSync, feedDate: string, force: boolean) {
	const ends = feederEnds(db);
	const signature = createHash('sha1')
		.update(feedDate + JSON.stringify(ends))
		.digest('hex');
	const loaded = db.prepare(`select value from meta where key = 'feeder_signature'`).get() as
		{ value: string } | undefined;
	if (loaded?.value === signature && !force) {
		console.log(`Feeder rides already loaded for these ${ends.length} route ends.`);
		return;
	}

	const t0 = Date.now();
	const stops: Stop[] = [];
	await eachRow(ZIP_PATH, 'stops.txt', (r) => {
		if (r.location_type && r.location_type !== '0') return; // stations/entrances, not stops
		stops.push({ id: r.stop_id, name: r.stop_name, at: [Number(r.stop_lon), Number(r.stop_lat)] });
	});
	const stopName = new Map(stops.map((s) => [s.id, s.name]));
	const near = ends.map((e) => ({
		end: e,
		route: stopsNear(stops, e.route, ROUTE_STOP_M),
		station: stopsNear(stops, e.station, STATION_STOP_M)
	}));
	const wanted = new Set(near.flatMap((n) => [...n.route.keys(), ...n.station.keys()]));

	const operators = new Map<string, string>();
	await eachRow(ZIP_PATH, 'agency.txt', (r) => operators.set(r.agency_id, r.agency_name));
	const routes = new Map<string, { line: string; operator: string | null }>();
	await eachRow(ZIP_PATH, 'routes.txt', (r) => {
		if (!isFeederMode(r.route_type)) return;
		routes.set(r.route_id, {
			line: lineName(r.route_type, r.route_short_name),
			operator: operators.get(r.agency_id) ?? null
		});
	});
	const trips = new Map<string, { route: string; service: string; headsign: string }>();
	await eachRow(ZIP_PATH, 'trips.txt', (r) => {
		if (routes.has(r.route_id))
			trips.set(r.trip_id, { route: r.route_id, service: r.service_id, headsign: r.trip_headsign });
	});

	const byTrip = new Map<string, StopTime[]>();
	await eachRow(ZIP_PATH, 'stop_times.txt', (r) => {
		if (!wanted.has(r.stop_id) || !trips.has(r.trip_id)) return;
		let list = byTrip.get(r.trip_id);
		if (!list) byTrip.set(r.trip_id, (list = []));
		list.push({
			stopId: r.stop_id,
			seq: Number(r.stop_sequence),
			arr: gtfsTime(r.arrival_time),
			dep: gtfsTime(r.departure_time),
			pickup: r.pickup_type !== '1',
			dropOff: r.drop_off_type !== '1'
		});
	});

	type Row = [
		string,
		string,
		number,
		string,
		string,
		string | null,
		string,
		string,
		string,
		number,
		number,
		number
	];
	const rows: Row[] = [];
	const services = new Set<string>();
	for (const { end, route, station } of near) {
		let count = 0;
		for (const [tripId, stopTimes] of byTrip) {
			const ride = feederRide(stopTimes, end.side, route, station);
			if (!ride) continue;
			const trip = trips.get(tripId)!;
			const { line, operator } = routes.get(trip.route)!;
			services.add(trip.service);
			rows.push([
				end.walkId,
				end.side,
				Number(tripId),
				trip.service,
				line,
				operator,
				trip.headsign,
				stopName.get(ride.board.stopId) ?? '?',
				stopName.get(ride.alight.stopId) ?? '?',
				ride.board.dep,
				ride.alight.arr,
				ride.stopM
			]);
			count++;
		}
		if (!count) console.log(`  no bus between ${end.walkId} (${end.side}) and its station`);
	}

	const serviceDates: [string, string][] = [];
	await eachRow(ZIP_PATH, 'calendar_dates.txt', (r) => {
		if (r.exception_type === '1' && services.has(r.service_id))
			serviceDates.push([r.service_id, r.date]);
	});

	transaction(db, () => {
		db.exec('delete from feeder_trip; delete from feeder_service_date;');
		const insTrip = db.prepare(
			`insert or ignore into feeder_trip (walk_id, side, trip_id, service_id, line, operator, headsign,
				board, alight, dep, arr, stop_m) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		for (const row of rows) insTrip.run(...row);
		const insDate = db.prepare(
			'insert or ignore into feeder_service_date (service_id, date) values (?, ?)'
		);
		for (const [s, d] of serviceDates) insDate.run(s, d);
		db.prepare(`insert or replace into meta (key, value) values ('feeder_signature', ?)`).run(
			signature
		);
	});
	console.log(
		`Loaded ${rows.length} feeder rides for ${ends.length} route ends in ` +
			`${((Date.now() - t0) / 1000).toFixed(0)} s.`
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
