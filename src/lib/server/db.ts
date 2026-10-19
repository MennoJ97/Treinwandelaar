import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Who the personal layer belongs to when no Authentik username comes with the request. */
export const LOCAL_USER = 'local';

/* Personal layer, one row per (user, walk). */
const USER_WALK = `
create table if not exists user_walk (
	username text not null,           -- X-authentik-username, or LOCAL_USER
	walk_id text not null references walks(id) on delete cascade,
	status text check (status in ('wishlist', 'done')),
	own_rating integer check (own_rating between 1 and 5),
	notes text,
	done_date text,
	primary key (username, walk_id)
);`;

const SCHEMA = `
create table if not exists stations (
	code text primary key,
	uic text,
	name text not null,
	lat real not null,
	lng real not null
);

create table if not exists walks (
	id text primary key,              -- '<source>:<source_id>'
	source text not null,
	source_id text not null,
	collection text not null,         -- 'ns-wandeling' | 'ov-stapper' | 'streekpad' | 'law'
	name text not null,
	start_place text,
	end_place text,
	start_station text references stations(code),
	end_station text references stations(code),
	start_station_m integer,          -- distance route start ↔ station; > 2000 means a bus/taxi leg
	end_station_m integer,
	is_loop integer not null default 0,
	distance_km real not null,        -- measured from the GPX
	stated_distance_km real,          -- as published by the source
	description text,
	accessibility text,
	features text,                    -- JSON array
	geometry text not null,           -- JSON [[lng,lat],...], simplified
	paved_pct integer,
	dogs text,
	rating_avg real,
	review_count integer not null default 0,
	source_url text not null,
	ns_url text,
	gpx_url text,
	wandelnet_duplicate integer not null default 0, -- an OSM walk that Wandelnet's data also has
	updated_at text not null,         -- last ingest that wrote the row, changed or not
	changed_on text,                  -- YYYY-MM-DD the walk's data last changed: the sitemap's lastmod
	along text,                       -- JSON WalkAlong: places, nature, landscape along it (OSM only)
	og_card text                      -- version of its link-preview card in data/og/ (OSM only)
);

create table if not exists walk_photos (
	walk_id text not null references walks(id) on delete cascade,
	url text not null,
	caption text,
	source text not null,
	sort integer not null default 0,
	primary key (walk_id, url)
);

-- Whole LAW routes and streekpaden, to plan your own station-to-station stretches (src/lib/path.ts).
create table if not exists paths (
	id text primary key,              -- 'pad:<slug>' | 'osm:<slug>'
	source text not null,
	collection text not null,         -- 'law' | 'streekpad'
	name text not null,
	km real not null,
	lines text not null,              -- JSON [[[lng,lat],...],...], simplified like walks.geometry
	stops text not null,              -- JSON PathStop[]: stations within walking distance, in path order
	stages text not null,             -- JSON PathStage[]
	source_url text not null,
	wandelnet_duplicate integer not null default 0, -- an OSM path that Wandelnet's data also has
	updated_at text not null,
	profile text                      -- JSON AlongProfile per line: what it passes (src/lib/along.ts)
);

-- Stage ends of those paths far from a station but on a bus line to one (scripts/ingest/gtfs.ts): more
-- places to start or end a stretch. Their rides are in feeder_trip, under walk_id '<path id>:<key>'.
create table if not exists path_bus_stop (
	path_id text not null,
	key text not null,                -- 'e3': end of stage 3 (index in paths.stages); 's0': start of stage 0
	place text not null,              -- "Zuidlaren"
	station text not null,            -- where the bus runs to and from
	line integer not null,
	idx integer not null,             -- point on the line
	km real not null,
	metres integer not null,          -- straight line to the station
	primary key (path_id, key)
);

${USER_WALK}

-- Rail timetable from the OVapi GTFS (scripts/ingest/gtfs.ts), for the offline travel-time map.
create table if not exists gtfs_service_date (
	service_id text not null,
	date text not null,               -- YYYYMMDD
	primary key (date, service_id)
);

create table if not exists gtfs_trip (
	trip_id integer primary key,
	service_id text not null,
	name text                         -- "Intercity", "Sprinter", "Stoptrein RS18", "Bus"…
);

create table if not exists gtfs_stop_time (
	trip_id integer not null,
	seq integer not null,
	code text not null,               -- NS station code
	arr integer not null,             -- seconds after midnight of the service day (may exceed 24h)
	dep integer not null,
	primary key (trip_id, seq)
) without rowid;

-- Buses (and trams, metros) between a route end too far to walk and its station, from the same GTFS
-- feed: only the trips that run between stops near the two. One row per trip and walk end. Rides for
-- walking a walk the other way round are under walk_id 'reverse:<walk id>', with start and end as
-- you'd walk it then.
create table if not exists feeder_trip (
	walk_id text not null,
	side text not null,               -- 'start': station → route start; 'end': route end → station
	trip_id integer not null,
	service_id text not null,
	line text not null,               -- "Bus 136"
	operator text,                    -- "Arriva"
	headsign text,
	board text not null,              -- stop names
	alight text not null,
	dep integer not null,             -- seconds after midnight of the service day
	arr integer not null,
	stop_m integer not null,          -- the walk between the stop and the route end, straight line
	geometry_id integer,              -- feeder_geometry: where it runs, board to alight
	primary key (walk_id, side, trip_id)
) without rowid;

-- Where the feeder rides run from boarding to getting off, along the GTFS shape (or stop to stop):
-- one row per way, shared by every trip that takes it.
create table if not exists feeder_geometry (
	id integer primary key,
	geometry text not null            -- JSON [[lng,lat],...], simplified like walks.geometry
);

create table if not exists feeder_service_date (
	service_id text not null,
	date text not null,               -- YYYYMMDD
	primary key (date, service_id)
);

create table if not exists meta (
	key text primary key,
	value text not null
);

create table if not exists trip_cache (
	key text primary key,
	json text not null,
	fetched_at integer not null,
	expires_at integer not null default 0 -- unix seconds; expired rows are pruned (ns.ts)
);
`;

let instance: DatabaseSync | undefined;

export function openDb(path = process.env.DATABASE_PATH ?? 'data/treinwandelaar.db'): DatabaseSync {
	if (instance) return instance;
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	// The app, the daily timetable sidecar and the weekly refresh share this file: wait for each
	// other's writes instead of failing.
	db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 60000;');
	initSchema(db);
	instance = db;
	return db;
}

/** Create missing tables and bring older databases up to date. */
export function initSchema(db: DatabaseSync) {
	db.exec(SCHEMA);
	migrate(db);
}

/** Additive migrations for databases created before a column existed. */
function migrate(db: DatabaseSync) {
	const columns = new Set(
		(db.prepare('pragma table_info(walks)').all() as { name: string }[]).map((c) => c.name)
	);
	if (!columns.has('collection'))
		db.exec(`alter table walks add column collection text not null default 'ns-wandeling'`);
	if (!columns.has('wandelnet_duplicate'))
		db.exec(`alter table walks add column wandelnet_duplicate integer not null default 0`);
	// Rows from before changed_on: the last ingest wrote what they hold now, so their data changed
	// on that day at the latest. Late rather than early, so a search engine never skips a change.
	if (!columns.has('along')) db.exec('alter table walks add column along text');
	if (!columns.has('og_card')) db.exec('alter table walks add column og_card text');
	if (!columns.has('changed_on')) {
		db.exec('alter table walks add column changed_on text');
		db.exec('update walks set changed_on = date(updated_at)');
	}
	const feederColumns = (
		db.prepare('pragma table_info(feeder_trip)').all() as { name: string }[]
	).map((c) => c.name);
	if (!feederColumns.includes('geometry_id'))
		db.exec('alter table feeder_trip add column geometry_id integer');

	// The NS cache used to keep every response forever. Rows from before expires_at get the longest
	// TTL in use (a week, reachability) and are pruned from then on.
	const cacheColumns = (
		db.prepare('pragma table_info(trip_cache)').all() as { name: string }[]
	).map((c) => c.name);
	if (!cacheColumns.includes('expires_at')) {
		db.exec(`alter table trip_cache add column expires_at integer not null default 0`);
		db.exec(`update trip_cache set expires_at = fetched_at + ${7 * 24 * 3600}`);
	}
	db.exec('create index if not exists trip_cache_expires on trip_cache (expires_at)');
	const pathColumns = (db.prepare('pragma table_info(paths)').all() as { name: string }[]).map(
		(c) => c.name
	);
	if (!pathColumns.includes('profile')) db.exec('alter table paths add column profile text');

	// The personal layer used to be single-user (keyed by walk_id alone); its rows go to LOCAL_USER.
	const userColumns = (db.prepare('pragma table_info(user_walk)').all() as { name: string }[]).map(
		(c) => c.name
	);
	if (!userColumns.includes('username'))
		transaction(db, () => {
			db.exec('alter table user_walk rename to user_walk_single');
			db.exec(USER_WALK);
			db.prepare(
				`insert into user_walk (username, walk_id, status, own_rating, notes, done_date)
				 select ?, walk_id, status, own_rating, notes, done_date from user_walk_single`
			).run(LOCAL_USER);
			db.exec('drop table user_walk_single');
		});
}

/** Run `fn` in a transaction; node:sqlite has no built-in helper. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
	db.exec('begin');
	try {
		const result = fn();
		db.exec('commit');
		return result;
	} catch (err) {
		db.exec('rollback');
		throw err;
	}
}
