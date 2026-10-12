import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
	start_station_m integer,          -- distance route start ↔ station; > 1500 means a bus/taxi leg
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
	updated_at text not null
);

create table if not exists walk_photos (
	walk_id text not null references walks(id) on delete cascade,
	url text not null,
	caption text,
	source text not null,
	sort integer not null default 0,
	primary key (walk_id, url)
);

create table if not exists user_walk (
	walk_id text primary key references walks(id) on delete cascade,
	status text check (status in ('wishlist', 'done')),
	own_rating integer check (own_rating between 1 and 5),
	notes text,
	done_date text
);

create table if not exists trip_cache (
	key text primary key,
	json text not null,
	fetched_at integer not null
);
`;

let instance: DatabaseSync | undefined;

export function openDb(path = process.env.DATABASE_PATH ?? 'data/treinwandelaar.db'): DatabaseSync {
	if (instance) return instance;
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
	db.exec(SCHEMA);
	migrate(db);
	instance = db;
	return db;
}

/** Additive migrations for databases created before a column existed. */
function migrate(db: DatabaseSync) {
	const columns = new Set(
		(db.prepare('pragma table_info(walks)').all() as { name: string }[]).map((c) => c.name)
	);
	if (!columns.has('collection'))
		db.exec(`alter table walks add column collection text not null default 'ns-wandeling'`);
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
