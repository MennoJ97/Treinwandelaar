/**
 * Walking routes from OpenStreetMap (ODbL): parse Overpass `out geom` relations, keep the ones that may
 * be shown publicly, and join their ways into lines. See the README ("The public demo") for which
 * routes qualify and why.
 */
import { haversine, type LngLat } from '../../src/lib/geo';
import type { Collection } from '../../src/lib/types';

export interface OsmRelation {
	type: 'relation';
	id: number;
	tags: Record<string, string>;
	members: {
		type: 'node' | 'way' | 'relation';
		ref: number;
		role: string;
		geometry?: { lat: number; lon: number }[];
		/** The way's own tags (highway, surface…), when read from the extract. */
		tags?: Record<string, string>;
	}[];
}

/** Hiking networks: national (LAW and the like), regional (streekpaden), local walks. */
const NETWORKS: Record<string, Collection> = { nwn: 'law', rwn: 'streekpad', lwn: 'lokaal' };

/**
 * Wandelnet refused permission for NS-wandelingen in OSM (2019), but some are still mapped: named
 * "NS-wandeling …" or "NS-wandeltocht …", or with NS among the operators ("LAW / NS", "NS;LAW").
 * A station in a name ("Breukelen NS") doesn't make a route an NS walk.
 */
export function isNsWalk(tags: Record<string, string>): boolean {
	const text = [tags.name, tags.description, tags.note].filter(Boolean).join(' ');
	return (
		/\bNS[- ]?wandel/i.test(text) ||
		/(^|[\s/;,(&])NS($|[\s/;,)&])/.test(tags.operator ?? '') ||
		/(^|\.|\/)ns\.nl\b/i.test(tags.website ?? '')
	);
}

/** Which collection a relation belongs to, or null when it shouldn't become a walk. */
export function classify(rel: OsmRelation): Collection | null {
	const { tags } = rel;
	if (tags.type !== 'route' || !['hiking', 'foot'].includes(tags.route)) return null;
	const collection = NETWORKS[tags.network];
	if (!collection || !tags.name || isNsWalk(tags)) return null;
	// Unnamed knooppunt links ("22-99") are filtered by the [name] in the query; some carry a name anyway.
	if (/^\d+\s*-\s*\d+$/.test(tags.name)) return null;
	return collection;
}

/**
 * "Marskramerpad - 14" → { path: 'Marskramerpad', stage: 14 }, also with the stage's places after it
 * ("Elfstedenpad - 01 - Leeuwarden-Mantgum"). LAW and streekpad stages are separate relations named
 * like this; local walks aren't staged.
 */
export function stageOf(name: string): { path: string; stage: number } | null {
	const m = /^(.+?)\s+[-–]\s+(?:etappe\s+)?(\d+)[a-z]?(?:\s*[-–:]\s+.+)?$/i.exec(name.trim());
	return m ? { path: m[1].trim(), stage: Number(m[2]) } : null;
}

/**
 * Spatial index of other routes (Wandelnet's walks), to tell whether an OSM walk covers the same ground.
 * Segments are bucketed in a grid of `cellM` metres in a local equirectangular projection.
 */
export function routeIndex(lines: LngLat[][], cellM = 250) {
	const lat0 = (52 * Math.PI) / 180;
	const project = ([lng, lat]: LngLat): [number, number] => [
		((lng * Math.PI) / 180) * Math.cos(lat0) * 6_371_000,
		((lat * Math.PI) / 180) * 6_371_000
	];
	const cells = new Map<string, [number, number, number, number][]>();
	for (const line of lines) {
		const pts = line.map(project);
		for (let i = 1; i < pts.length; i++) {
			const [x1, y1] = pts[i - 1];
			const [x2, y2] = pts[i];
			for (
				let cx = Math.floor(Math.min(x1, x2) / cellM);
				cx <= Math.floor(Math.max(x1, x2) / cellM);
				cx++
			)
				for (
					let cy = Math.floor(Math.min(y1, y2) / cellM);
					cy <= Math.floor(Math.max(y1, y2) / cellM);
					cy++
				) {
					const key = `${cx}:${cy}`;
					if (!cells.has(key)) cells.set(key, []);
					cells.get(key)!.push([x1, y1, x2, y2]);
				}
		}
	}

	/** Distance from a point to the nearest indexed segment, if within one cell; else Infinity. */
	function distance(p: LngLat): number {
		const [x, y] = project(p);
		let best = Infinity;
		const [cx, cy] = [Math.floor(x / cellM), Math.floor(y / cellM)];
		for (let dx = -1; dx <= 1; dx++)
			for (let dy = -1; dy <= 1; dy++)
				for (const [x1, y1, x2, y2] of cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
					const [vx, vy] = [x2 - x1, y2 - y1];
					const len = vx * vx + vy * vy;
					const t = len ? Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / len)) : 0;
					best = Math.min(best, Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy)));
				}
		return best;
	}

	/** Share of `track` (sampled every ~100 m) that runs within `maxMetres` of an indexed route. */
	return function sharedFraction(track: LngLat[], maxMetres = 75): number {
		const samples: LngLat[] = [track[0]];
		let since = 0;
		for (let i = 1; i < track.length; i++) {
			since += haversine(track[i - 1], track[i]);
			if (since >= 100) {
				samples.push(track[i]);
				since = 0;
			}
		}
		return samples.filter((p) => distance(p) <= maxMetres).length / samples.length;
	};
}

/** At least this share of an OSM walk on Wandelnet's ground makes it a copy of a Wandelnet walk. */
export const DUPLICATE_SHARE = 0.7;

/** Side branches that aren't part of the walk itself. */
const SKIP_ROLES = new Set(['alternative', 'excursion', 'approach', 'connection', 'backward']);

/**
 * Join a relation's ways, in member order, into continuous lines. Ways are flipped to connect
 * end-to-start; a gap over `maxGapMetres` (a ferry, an unmapped bit, a variant) starts a new line.
 */
export function stitch(rel: OsmRelation, maxGapMetres = 150): LngLat[][] {
	const ways = rel.members
		.filter(
			(m) => m.type === 'way' && m.geometry && m.geometry.length > 1 && !SKIP_ROLES.has(m.role)
		)
		.map((m) => m.geometry!.map((p): LngLat => [p.lon, p.lat]));
	const lines: LngLat[][] = [];
	let line: LngLat[] | null = null;
	let waysInLine = 0;
	for (const way of ways) {
		if (!line) {
			line = [...way];
			waysInLine = 1;
			lines.push(line);
			continue;
		}
		const end = line.at(-1)!;
		const options: { gap: number; apply: () => void }[] = [
			{ gap: haversine(end, way[0]), apply: () => line!.push(...way.slice(1)) },
			{ gap: haversine(end, way.at(-1)!), apply: () => line!.push(...[...way].reverse().slice(1)) }
		];
		if (waysInLine === 1) {
			// The first way's direction is a guess: it may have to be turned around to meet the second.
			const start = line[0];
			options.push(
				{ gap: haversine(start, way[0]), apply: () => line!.reverse().push(...way.slice(1)) },
				{
					gap: haversine(start, way.at(-1)!),
					apply: () => line!.reverse().push(...[...way].reverse().slice(1))
				}
			);
		}
		const best = options.reduce((a, b) => (b.gap < a.gap ? b : a));
		if (best.gap <= maxGapMetres) {
			best.apply();
			waysInLine++;
		} else {
			line = [...way];
			waysInLine = 1;
			lines.push(line);
		}
	}
	return lines;
}

/** A line that ends where it starts: a round walk. */
export const isClosed = (line: LngLat[], maxMetres = 300) =>
	line.length > 3 && haversine(line[0], line.at(-1)!) <= maxMetres;

/** The same loop, starting (and ending) at point `index`. */
export function rotateLoop(line: LngLat[], index: number): LngLat[] {
	const open = haversine(line[0], line.at(-1)!) < 1 ? line.slice(0, -1) : line;
	const rotated = [...open.slice(index), ...open.slice(0, index)];
	return [...rotated, rotated[0]];
}
