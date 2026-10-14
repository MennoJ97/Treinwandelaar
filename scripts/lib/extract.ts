/**
 * Walking routes from Geofabrik's daily extract of OpenStreetMap for the Netherlands, instead of
 * querying Overpass (often overloaded). Needs `osmium` (osmium-tool) on the PATH.
 *
 * The extract (~1.4 GB) is downloaded at most every few days; osmium keeps the route relations and
 * their ways, with each way's node locations inlined, as OPL: one text line per object.
 */
import { execFileSync } from 'node:child_process';
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync
} from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { OsmRelation } from './osm';

const EXTRACT_URL = 'https://download.geofabrik.de/europe/netherlands-latest.osm.pbf';
/** Geofabrik updates daily; a weekly refresh is plenty and kind to their servers. */
const MAX_AGE_DAYS = 6;

/** OPL escapes special characters in tags as %<hex code point>%. */
const unescape = (s: string) =>
	s.replace(/%([0-9a-fA-F]+)%/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));

function tagsOf(field: string | undefined): Record<string, string> {
	const tags: Record<string, string> = {};
	if (!field) return tags;
	for (const pair of field.split(',')) {
		const eq = pair.indexOf('=');
		if (eq > 0) tags[unescape(pair.slice(0, eq))] = unescape(pair.slice(eq + 1));
	}
	return tags;
}

/**
 * Route relations from OPL with way locations inlined (`osmium add-locations-to-ways -f opl`), in
 * the shape of Overpass `out geom`, so the same code turns them into walks.
 */
export function parseRoutesOpl(opl: string): OsmRelation[] {
	const ways = new Map<number, { lat: number; lon: number }[]>();
	const relations: OsmRelation[] = [];
	for (const line of opl.split('\n')) {
		const kind = line[0];
		if (kind !== 'w' && kind !== 'r') continue;
		const fields = new Map<string, string>();
		for (const field of line.split(' ').slice(1)) fields.set(field[0], field.slice(1));
		const id = Number(line.slice(1, line.indexOf(' ')));
		if (kind === 'w') {
			// N: n123x4.8901y52.3702,n124x…  (a node without a location has no x/y)
			const geometry: { lat: number; lon: number }[] = [];
			for (const node of (fields.get('N') ?? '').split(',')) {
				const m = /x(-?[\d.]+)y(-?[\d.]+)$/.exec(node);
				if (m) geometry.push({ lon: Number(m[1]), lat: Number(m[2]) });
			}
			ways.set(id, geometry);
		} else {
			// M: w12@,w13@forward,n5@guidepost,r6@
			const members = (fields.get('M') ?? '')
				.split(',')
				.filter(Boolean)
				.map((m) => {
					const at = m.indexOf('@');
					const type = ({ n: 'node', w: 'way', r: 'relation' } as const)[m[0] as 'n' | 'w' | 'r'];
					return { type, ref: Number(m.slice(1, at)), role: unescape(m.slice(at + 1)) };
				});
			relations.push({ type: 'relation', id, tags: tagsOf(fields.get('T')), members });
		}
	}
	// Ways come before relations in OPL, but attach geometry afterwards to be safe.
	for (const rel of relations)
		for (const m of rel.members)
			if (m.type === 'way') Object.assign(m, { geometry: ways.get(m.ref) });
	return relations;
}

async function download(url: string, file: string) {
	const res = await fetch(url, {
		headers: { 'User-Agent': 'Treinwandelaar/0.1 (personal, non-commercial walk planner)' }
	});
	if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText} for ${url}`);
	const partial = `${file}.part`;
	await pipeline(Readable.fromWeb(res.body as never), createWriteStream(partial));
	renameSync(partial, file);
}

/**
 * The walking-route relations of the Netherlands, plus the moment the extract's data is from.
 * Downloads a new extract when the one in `dir` is older than MAX_AGE_DAYS (or with --refresh).
 */
export async function hikingRoutes(
	dir: string
): Promise<{ relations: OsmRelation[]; dataFrom: Date }> {
	mkdirSync(dir, { recursive: true });
	const pbf = join(dir, 'netherlands-latest.osm.pbf');
	const stale =
		!existsSync(pbf) ||
		process.argv.includes('--refresh') ||
		Date.now() - statSync(pbf).mtimeMs > MAX_AGE_DAYS * 24 * 3600_000;
	if (stale) {
		console.log(`Downloading ${EXTRACT_URL} (~1.4 GB)…`);
		await download(EXTRACT_URL, pbf);
	}

	const routes = join(dir, 'hiking-routes.osm.pbf');
	const opl = join(dir, 'hiking-routes.opl');
	const osmium = (...args: string[]) =>
		execFileSync('osmium', args, { stdio: ['ignore', 'pipe', 'inherit'] });
	osmium('tags-filter', pbf, 'r/route=hiking,foot', '-o', routes, '--overwrite');
	osmium('add-locations-to-ways', routes, '-f', 'opl', '-o', opl, '--overwrite');

	const stamp = osmium('fileinfo', pbf, '-g', 'header.option.osmosis_replication_timestamp')
		.toString()
		.trim();
	return {
		relations: parseRoutesOpl(readFileSync(opl, 'utf8')),
		dataFrom: stamp ? new Date(stamp) : statSync(pbf).mtime
	};
}
