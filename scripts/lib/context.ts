/**
 * What a walk passes, from OpenStreetMap (ODbL): the villages, nature areas and sights along it, how
 * much of it runs through forest, heath, dunes or built-up area, and how much is paved. For the
 * walk's own page (src/routes/route/[id]), so each one says something of its own.
 *
 * Every walk is sampled every SAMPLE_M metres; the samples go into one grid, and each OSM feature is
 * matched against the samples near it as it streams past. So nothing big is held in memory: not the
 * 650k features, nor the route ways.
 */
import { haversine, type LngLat } from '../../src/lib/geo';
import { coverCode, PROFILE_STEP_KM, type AlongProfile } from '../../src/lib/along';
import type { Cover } from '../../src/lib/types';

/** As the stored profiles count (one character per step). */
const SAMPLE_M = PROFILE_STEP_KM * 1000;
const CELL_M = 250;

/** How close a village's (or town's…) node has to be for the walk to pass it. */
const PLACE_RADIUS_M: Record<string, number> = {
	city: 2500,
	town: 1500,
	village: 700,
	hamlet: 300
};
const SIGHT_RADIUS_M = 150;
/** A sample on a route way: the way the walk follows there, not one crossing it. */
const ON_WAY_M = 20;

/** When polygons overlap (a wood in the dunes, a village in a forest), the rarer landscape wins. */
const COVER_PRIORITY: Record<Cover, number> = { dunes: 4, heath: 3, forest: 2, builtUp: 1 };

const LAT0 = (52 * Math.PI) / 180;
const project = ([lng, lat]: LngLat): [number, number] => [
	((lng * Math.PI) / 180) * Math.cos(LAT0) * 6_371_000,
	((lat * Math.PI) / 180) * 6_371_000
];

/** Points every `every` metres along a track, with how far along it they are. */
export function samplePoints(track: LngLat[], every = SAMPLE_M): { at: LngLat; km: number }[] {
	if (!track.length) return [];
	const out = [{ at: track[0], km: 0 }];
	let along = 0;
	let next = every;
	for (let i = 1; i < track.length; i++) {
		const [a, b] = [track[i - 1], track[i]];
		const d = haversine(a, b);
		while (d > 0 && along + d >= next) {
			const t = (next - along) / d;
			out.push({ at: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], km: next / 1000 });
			next += every;
		}
		along += d;
	}
	return out;
}

/** OSM's surface tags, or the kind of way where those are missing; null when it can't be told. */
export function surfaceOf(tags: Record<string, string>): 'paved' | 'unpaved' | null {
	const surface = tags.surface?.split(':')[0];
	if (surface) {
		if (
			/^(paved|asphalt|concrete|paving_stones|sett|cobblestone|unhewn_cobblestone|bricks|metal|wood|chipseal)$/.test(
				surface
			)
		)
			return 'paved';
		if (
			/^(unpaved|compacted|fine_gravel|gravel|pebblestone|ground|dirt|earth|grass|sand|mud|woodchips|shells|rock)$/.test(
				surface
			)
		)
			return 'unpaved';
		return null;
	}
	const highway = tags.highway;
	if (
		/^(primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|cycleway)$/.test(
			highway ?? ''
		)
	)
		return 'paved';
	if (highway === 'track') {
		if (tags.tracktype === 'grade1') return 'paved';
		if (/^grade[2-5]$/.test(tags.tracktype ?? '')) return 'unpaved';
	}
	return null;
}

/** Forest, heath, dunes (sand, beach) or built-up area, from a polygon's tags. */
export function coverOf(tags: Record<string, string>): Cover | null {
	if (tags.landuse === 'forest' || tags.natural === 'wood') return 'forest';
	if (tags.natural === 'heath') return 'heath';
	if (['sand', 'dune', 'beach'].includes(tags.natural)) return 'dunes';
	if (tags.landuse === 'residential') return 'builtUp';
	return null;
}

const isNature = (tags: Record<string, string>) =>
	tags.leisure === 'nature_reserve' || ['national_park', 'protected_area'].includes(tags.boundary);

/** "molen De Hoop", "Kasteel Doorwerth", "uitkijkpunt Holterberg"; null for anything else. */
export function sightOf(tags: Record<string, string>): string | null {
	const name = tags.name?.trim();
	if (!name) return null;
	const kind =
		tags.man_made === 'windmill' || tags.man_made === 'watermill' || tags.historic === 'windmill'
			? 'molen'
			: tags.man_made === 'lighthouse'
				? 'vuurtoren'
				: tags.tourism === 'viewpoint'
					? 'uitkijkpunt'
					: ['castle', 'manor', 'fort', 'ruins', 'monastery'].includes(tags.historic) ||
						  tags.tourism === 'attraction'
						? ''
						: null;
	if (kind === null) return null;
	// The name often says what it is already: "Molen De Hoop", "Uitkijktoren Lemelerberg".
	const says = { molen: /molen/i, vuurtoren: /vuurtoren/i, uitkijkpunt: /uitkijk|uitzicht/i }[
		kind as 'molen'
	];
	return !kind || says?.test(name) ? name : `${kind} ${name}`;
}

/** Ray casting, with holes: rings[0] is the outline. */
function inRings(p: [number, number], rings: [number, number][][]): boolean {
	let inside = false;
	for (const ring of rings)
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [xi, yi] = ring[i];
			const [xj, yj] = ring[j];
			if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
				inside = !inside;
		}
	return inside;
}

function segmentDistance(p: [number, number], a: [number, number], b: [number, number]) {
	const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
	const len = vx * vx + vy * vy;
	const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len)) : 0;
	return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

const COVER_BY_PRIORITY = Object.fromEntries(
	Object.entries(COVER_PRIORITY).map(([c, p]) => [p, c as Cover])
) as Record<number, Cover>;
const SURFACES = [null, 'paved', 'unpaved'] as const;

export interface GeoFeature {
	geometry: { type: string; coordinates: unknown } | null;
	properties: Record<string, string>;
}

/**
 * Collects what each of `tracks` passes. Feed it the route ways (addWay) and the context features
 * (addFeature) in any order, then read the result with done().
 */
export function walkContext(tracks: LngLat[][]) {
	// The samples as columns, not objects: about a million of them for every walk and path.
	const walkOf: number[] = [];
	const kmOf: number[] = [];
	const xOf: number[] = [];
	const yOf: number[] = [];
	const cells = new Map<number, number[]>();
	const cellKey = (cx: number, cy: number) => cx * 100_000 + cy;
	tracks.forEach((track, walk) => {
		for (const { at, km } of samplePoints(track)) {
			const [x, y] = project(at);
			const key = cellKey(Math.floor(x / CELL_M), Math.floor(y / CELL_M));
			if (!cells.has(key)) cells.set(key, []);
			cells.get(key)!.push(walkOf.length);
			walkOf.push(walk);
			kmOf.push(km);
			xOf.push(x);
			yOf.push(y);
		}
	});
	const n = walkOf.length;
	/** COVER_PRIORITY of the landscape at each sample (0: none of them). */
	const coverAt = new Uint8Array(n);
	/** Index into SURFACES of the nearest route way, and how far that way is. */
	const surfaceAt = new Uint8Array(n);
	const wayM = new Float64Array(n).fill(Infinity);

	/** Indices of the samples in the box [x0, y0]–[x1, y1] (projected metres). */
	function* inBox(x0: number, y0: number, x1: number, y1: number) {
		for (let cx = Math.floor(x0 / CELL_M); cx <= Math.floor(x1 / CELL_M); cx++)
			for (let cy = Math.floor(y0 / CELL_M); cy <= Math.floor(y1 / CELL_M); cy++)
				yield* cells.get(cellKey(cx, cy)) ?? [];
	}

	const places = tracks.map(() => new Map<string, { km: number; rank: number }>());
	// Every sample inside a nature area, as km: a whole path can enter the same one twice.
	const nature = tracks.map(() => new Map<string, number[]>());
	const sights = tracks.map(() => new Map<string, number>());
	const note = (map: Map<string, number>, name: string, km: number) => {
		if (!map.has(name) || km < map.get(name)!) map.set(name, km);
	};

	/** Nearest sample of each walk within `metres` of `xy`. */
	function nearest(xy: [number, number], metres: number) {
		const best = new Map<number, { km: number; d: number }>();
		for (const i of inBox(xy[0] - metres, xy[1] - metres, xy[0] + metres, xy[1] + metres)) {
			const d = Math.hypot(xOf[i] - xy[0], yOf[i] - xy[1]);
			if (d <= metres && d < (best.get(walkOf[i])?.d ?? Infinity))
				best.set(walkOf[i], { km: kmOf[i], d });
		}
		return best;
	}

	function addWay(line: LngLat[], tags: Record<string, string>) {
		const surface = surfaceOf(tags);
		const pts = line.map(project);
		for (let i = 1; i < pts.length; i++) {
			const [a, b] = [pts[i - 1], pts[i]];
			for (const i of inBox(
				Math.min(a[0], b[0]) - ON_WAY_M,
				Math.min(a[1], b[1]) - ON_WAY_M,
				Math.max(a[0], b[0]) + ON_WAY_M,
				Math.max(a[1], b[1]) + ON_WAY_M
			)) {
				const d = segmentDistance([xOf[i], yOf[i]], a, b);
				if (d <= ON_WAY_M && d < wayM[i]) {
					wayM[i] = d;
					surfaceAt[i] = SURFACES.indexOf(surface);
				}
			}
		}
	}

	function addFeature({ geometry, properties: tags }: GeoFeature) {
		if (!geometry) return;
		const name = tags.name?.trim();
		const polygons: [number, number][][][] =
			geometry.type === 'Polygon'
				? [(geometry.coordinates as LngLat[][]).map((r) => r.map(project))]
				: geometry.type === 'MultiPolygon'
					? (geometry.coordinates as LngLat[][][]).map((p) => p.map((r) => r.map(project)))
					: [];
		const point =
			geometry.type === 'Point'
				? project(geometry.coordinates as LngLat)
				: polygons.length
					? centre(polygons[0][0])
					: null;
		if (!point) return;

		if (geometry.type === 'Point' && name && PLACE_RADIUS_M[tags.place])
			for (const [walk, { km }] of nearest(point, PLACE_RADIUS_M[tags.place])) {
				const rank = Object.keys(PLACE_RADIUS_M).indexOf(tags.place);
				const seen = places[walk].get(name);
				if (!seen || km < seen.km) places[walk].set(name, { km, rank });
			}

		const sight = sightOf(tags);
		if (sight)
			for (const [walk, { km }] of nearest(point, SIGHT_RADIUS_M)) note(sights[walk], sight, km);

		const cover = coverOf(tags);
		const reserve = name && isNature(tags) ? name : null;
		if (!cover && !reserve) return;
		for (const rings of polygons) {
			for (const i of inBox(...bbox(rings[0]))) {
				if (!inRings([xOf[i], yOf[i]], rings)) continue;
				if (cover) coverAt[i] = Math.max(coverAt[i], COVER_PRIORITY[cover]);
				if (reserve) {
					const kms = nature[walkOf[i]].get(reserve) ?? [];
					kms.push(kmOf[i]);
					nature[walkOf[i]].set(reserve, kms);
				}
			}
		}
	}

	const km2 = (km: number) => Math.round(km * 100) / 100;

	/** Each track's profile (see AlongProfile); summed up for a walk with alongOf(profile). */
	function done(): AlongProfile[] {
		// A track's samples are one run, in order.
		const byWalk = tracks.map((): number[] => []);
		for (let i = 0; i < n; i++) byWalk[walkOf[i]].push(i);
		return byWalk.map((own, walk) => {
			const ranges: [string, number, number][] = [];
			for (const [name, kms] of nature[walk]) {
				kms.sort((a, b) => a - b);
				// Samples close together are one visit; a gap of more than 500 m is another.
				let from = kms[0];
				for (let i = 1; i <= kms.length; i++)
					if (i === kms.length || kms[i] - kms[i - 1] > 0.5) {
						ranges.push([name, km2(from), km2(kms[i - 1])]);
						from = kms[i];
					}
			}
			return {
				cover: own.map((i) => coverCode(COVER_BY_PRIORITY[coverAt[i]] ?? null)).join(''),
				surface: own.map((i) => SURFACES[surfaceAt[i]]?.[0] ?? '-').join(''),
				places: [...places[walk]].map(([name, { km, rank }]) => [name, km2(km), rank]),
				nature: ranges,
				sights: [...sights[walk]].map(([name, km]) => [name, km2(km)])
			};
		});
	}

	return { addWay, addFeature, done };
}

/** [minX, minY, maxX, maxY] in a loop: a coastline polygon has too many points to spread. */
function bbox(ring: [number, number][]): [number, number, number, number] {
	let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const [x, y] of ring) {
		if (x < x0) x0 = x;
		if (y < y0) y0 = y;
		if (x > x1) x1 = x;
		if (y > y1) y1 = y;
	}
	return [x0, y0, x1, y1];
}

function centre(ring: [number, number][]): [number, number] {
	const n = ring.length || 1;
	return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
}
