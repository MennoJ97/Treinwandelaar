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
 * route ends too far from a station to walk and that station (see ../lib/feeders.ts). The same for the
 * stage ends of LAW routes and streekpaden far from a station, except that there the timetable tells
 * which station the bus runs to: those become extra stops to plan stretches from (path_bus_stop).
 * Those depend on the walks and paths, so run this after their ingests; it reloads the rides whenever
 * the route ends change.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import type { DatabaseSync } from 'node:sqlite';
import { haversine, type LngLat } from '../../src/lib/geo';
import { openDb, transaction } from '../../src/lib/server/db';
import { parseStretchId } from '../../src/lib/path';
import { WALKABLE_STATION_M, type PathStage, type PathStop } from '../../src/lib/types';
import { gtfsTime, parseCsvLine } from '../lib/csv';
import {
	ROUTE_STOP_M,
	STATION_STOP_M,
	busStation,
	feederRide,
	isFeederMode,
	lineName,
	stationStops,
	stationsReached,
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
		// A stretch you planned and kept from a path's stage end has its rides under the stage end.
		if (parseStretchId(r.id)) continue;
		const line = JSON.parse(r.geometry) as LngLat[];
		if ((r.start_station_m ?? 0) > WALKABLE_STATION_M && r.s1_lng != null && r.s1_lat != null)
			ends.push({ walkId: r.id, side: 'start', route: line[0], station: [r.s1_lng, r.s1_lat] });
		if ((r.end_station_m ?? 0) > WALKABLE_STATION_M && r.s2_lng != null && r.s2_lat != null)
			ends.push({ walkId: r.id, side: 'end', route: line.at(-1)!, station: [r.s2_lng, r.s2_lat] });
	}
	return ends;
}

/** A stage end of a path this far along it from a station is left to that station: walk there. */
const NEAR_STATION_KM = 3;

interface StageEnd {
	pathId: string;
	/** 'e3' (end of stage 3, by index) or 's0' (start of a line's first stage): see PathStop.key. */
	key: string;
	place: string | null;
	line: number;
	index: number;
	km: number;
	at: LngLat;
}

/** Where the paths' stages begin and end, away from their stations: candidates for a bus stop. */
function stageEnds(db: DatabaseSync): StageEnd[] {
	const rows = db.prepare('select id, lines, stops, stages from paths order by id').all() as {
		id: string;
		lines: string;
		stops: string;
		stages: string;
	}[];
	const ends: StageEnd[] = [];
	for (const r of rows) {
		const lines = JSON.parse(r.lines) as LngLat[][];
		const stops = JSON.parse(r.stops) as PathStop[];
		const stages = JSON.parse(r.stages) as PathStage[];
		const add = (key: string, stage: PathStage, which: 'from' | 'to') => {
			const km = stage[`${which}Km`];
			if (stops.some((s) => s.line === stage.line && Math.abs(s.km - km) < NEAR_STATION_KM)) return;
			const index = stage[`${which}Index`];
			const [from, to] = stage.places?.split(' – ') ?? [];
			ends.push({
				pathId: r.id,
				key,
				place: (which === 'from' ? from : to) || null,
				line: stage.line,
				index,
				km,
				at: lines[stage.line][index]
			});
		};
		stages.forEach((stage, i) => {
			if (stages[i - 1]?.line !== stage.line) add(`s${i}`, stage, 'from');
			add(`e${i}`, stage, 'to');
		});
	}
	return ends;
}

/** The stop_times rows `keep` accepts, grouped by trip. */
async function stopTimesByTrip(
	keep: (row: Record<string, string>) => boolean
): Promise<Map<string, StopTime[]>> {
	const byTrip = new Map<string, StopTime[]>();
	await eachRow(ZIP_PATH, 'stop_times.txt', (r) => {
		if (!keep(r)) return;
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
	return byTrip;
}

/**
 * Feeder rides for every far route end and every stage end a bus serves. Streams stop_times twice,
 * keeping only the stops near those ends and near stations (a few thousand of the ~60k): first to find
 * the trips that call near an end, then for those trips' calls near a station.
 */
async function loadFeeders(db: DatabaseSync, feedDate: string, force: boolean) {
	const ends = feederEnds(db);
	const stages = stageEnds(db);
	const signature = createHash('sha1')
		.update(feedDate + JSON.stringify(ends) + JSON.stringify(stages))
		.digest('hex');
	const loaded = db.prepare(`select value from meta where key = 'feeder_signature'`).get() as
		{ value: string } | undefined;
	if (loaded?.value === signature && !force) {
		console.log(
			`Feeder rides already loaded for these ${ends.length} route ends and ${stages.length} stage ends.`
		);
		return;
	}

	const t0 = Date.now();
	const stops: Stop[] = [];
	await eachRow(ZIP_PATH, 'stops.txt', (r) => {
		if (r.location_type && r.location_type !== '0') return; // stations/entrances, not stops
		stops.push({ id: r.stop_id, name: r.stop_name, at: [Number(r.stop_lon), Number(r.stop_lat)] });
	});
	const stopName = new Map(stops.map((s) => [s.id, s.name]));
	const stations = db.prepare('select code, name, lng, lat from stations').all() as {
		code: string;
		name: string;
		lng: number;
		lat: number;
	}[];
	const stationAt = new Map(stations.map((s) => [s.code, [s.lng, s.lat] as LngLat]));
	const stationOf = stationStops(
		stops,
		stations.map((s) => ({ code: s.code, at: [s.lng, s.lat] as LngLat })),
		STATION_STOP_M
	);
	const near = ends.map((e) => ({
		end: e,
		route: stopsNear(stops, e.route, ROUTE_STOP_M),
		station: stopsNear(stops, e.station, STATION_STOP_M)
	}));
	const stagesNear = stages
		.map((end) => ({ end, route: stopsNear(stops, end.at, ROUTE_STOP_M) }))
		.filter((n) => n.route.size);
	// The stops at the route's side of a ride; every stop by a station is on the other side's list.
	const endStops = new Set([...near, ...stagesNear].flatMap((n) => [...n.route.keys()]));
	const wanted = new Set([
		...endStops,
		...stationOf.keys(),
		...near.flatMap((n) => [...n.station.keys()])
	]);

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

	const calling = new Set(
		(await stopTimesByTrip((r) => endStops.has(r.stop_id) && trips.has(r.trip_id))).keys()
	);
	const byTrip = await stopTimesByTrip((r) => calling.has(r.trip_id) && wanted.has(r.stop_id));
	/** Per stop near a route end, the trips calling there. */
	const tripsAt = new Map<string, string[]>();
	for (const [tripId, calls] of byTrip)
		for (const c of calls)
			if (endStops.has(c.stopId)) {
				let list = tripsAt.get(c.stopId);
				if (!list) tripsAt.set(c.stopId, (list = []));
				list.push(tripId);
			}
	const tripsNear = (route: Map<string, number>) => [
		...new Set([...route.keys()].flatMap((id) => tripsAt.get(id) ?? []))
	];

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
	/** The rides one trip offers between a route end and its station, as rows; how many. */
	function addRides(
		walkId: string,
		sides: FeederEnd['side'][],
		tripIds: string[],
		route: Map<string, number>,
		station: Map<string, number>
	) {
		let count = 0;
		for (const tripId of tripIds)
			for (const side of sides) {
				const ride = feederRide(byTrip.get(tripId)!, side, route, station);
				if (!ride) continue;
				const trip = trips.get(tripId)!;
				const { line, operator } = routes.get(trip.route)!;
				services.add(trip.service);
				rows.push([
					walkId,
					side,
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
		return count;
	}

	const stranded: typeof near = [];
	for (const n of near)
		if (!addRides(n.end.walkId, [n.end.side], tripsNear(n.route), n.route, n.station))
			stranded.push(n);
	if (stranded.length) suggestStations(stations, stranded, stationOf, byTrip, trips, routes);

	const busStops: (StageEnd & { place: string; station: string; metres: number })[] = [];
	for (const { end, route } of stagesNear) {
		const tripIds = tripsNear(route);
		const choice = busStation(
			tripIds.map((id) => byTrip.get(id)!),
			route,
			stationOf
		);
		if (!choice) continue;
		const at = stationAt.get(choice.code)!;
		const metres = Math.round(haversine(end.at, at));
		if (metres <= WALKABLE_STATION_M) continue; // a station stop on the path covers it
		const station = stopsNear(stops, at, STATION_STOP_M);
		addRides(`${end.pathId}:${end.key}`, ['start', 'end'], tripIds, route, station);
		// Unnamed stage ends take the town from the nearest stop's name ("Schoonloo, Hoofdweg").
		const nearest = [...route].sort((a, b) => a[1] - b[1])[0][0];
		const place = end.place ?? stopName.get(nearest)?.split(',')[0].trim() ?? '?';
		busStops.push({ ...end, place, station: choice.code, metres });
	}

	const serviceDates: [string, string][] = [];
	await eachRow(ZIP_PATH, 'calendar_dates.txt', (r) => {
		if (r.exception_type === '1' && services.has(r.service_id))
			serviceDates.push([r.service_id, r.date]);
	});

	transaction(db, () => {
		db.exec('delete from feeder_trip; delete from feeder_service_date; delete from path_bus_stop;');
		const insTrip = db.prepare(
			`insert or ignore into feeder_trip (walk_id, side, trip_id, service_id, line, operator, headsign,
				board, alight, dep, arr, stop_m) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		for (const row of rows) insTrip.run(...row);
		const insDate = db.prepare(
			'insert or ignore into feeder_service_date (service_id, date) values (?, ?)'
		);
		for (const [s, d] of serviceDates) insDate.run(s, d);
		const insStop = db.prepare(
			`insert or replace into path_bus_stop (path_id, key, place, station, line, idx, km, metres)
			 values (?, ?, ?, ?, ?, ?, ?, ?)`
		);
		for (const b of busStops)
			insStop.run(b.pathId, b.key, b.place, b.station, b.line, b.index, b.km, b.metres);
		db.prepare(`insert or replace into meta (key, value) values ('feeder_signature', ?)`).run(
			signature
		);
	});
	console.log(
		`Loaded ${rows.length} feeder rides for ${ends.length} route ends and ${busStops.length} of ` +
			`${stages.length} stage ends away from a station in ${((Date.now() - t0) / 1000).toFixed(0)} s.`
	);
}

/**
 * Route ends with no direct ride to their station: the stations a line from there does reach, with
 * the typical ride, so the walk can be pointed at the best one in scripts/ingest/overrides.json.
 */
function suggestStations(
	stations: { code: string; name: string }[],
	stranded: { end: FeederEnd; route: Map<string, number> }[],
	stationOf: Map<string, string>,
	byTrip: Map<string, StopTime[]>,
	trips: Map<string, { route: string }>,
	routes: Map<string, { line: string }>
) {
	const stationName = new Map(stations.map((s) => [s.code, s.name]));

	for (const { end, route } of stranded) {
		const reached = new Map<string, { seconds: number[]; lines: Set<string> }>();
		for (const [tripId, calls] of byTrip)
			for (const [code, seconds] of stationsReached(calls, end.side, route, stationOf)) {
				let r = reached.get(code);
				if (!r) reached.set(code, (r = { seconds: [], lines: new Set() }));
				r.seconds.push(seconds);
				r.lines.add(routes.get(trips.get(tripId)!.route)!.line);
			}
		const options = [...reached]
			.map(([code, r]) => {
				const sorted = r.seconds.sort((a, b) => a - b);
				return { code, min: Math.round(sorted[sorted.length >> 1] / 60), lines: [...r.lines] };
			})
			.sort((a, b) => a.min - b.min)
			.map((o) => `${o.code} ${stationName.get(o.code)} (${o.min} min, ${o.lines.join('/')})`);
		console.log(
			`  no bus between ${end.walkId} (${end.side}) and its station` +
				(options.length
					? `; direct lines reach ${options.slice(0, 3).join(', ')}: ` +
						`set ${end.side}Station in overrides.json`
					: '')
		);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
