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
 * "Marskramerpad - 14" → { path: 'Marskramerpad', stage: 14 }. LAW and streekpad stages are separate
 * relations named like this; local walks aren't staged.
 */
export function stageOf(name: string): { path: string; stage: number } | null {
	const m = /^(.+?)\s+[-–]\s+(?:etappe\s+)?(\d+)[a-z]?$/i.exec(name.trim());
	return m ? { path: m[1].trim(), stage: Number(m[2]) } : null;
}

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
