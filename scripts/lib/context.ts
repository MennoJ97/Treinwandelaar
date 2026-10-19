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
import type { Cover, WalkAlong } from '../../src/lib/types';

const SAMPLE_M = 50;
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

const MAX = { places: 8, nature: 5, sights: 6 };

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

interface Sample {
	walk: number;
	km: number;
	xy: [number, number];
	cover: Cover | null;
	surface: 'paved' | 'unpaved' | null;
	/** Distance to the nearest route way seen so far. */
	wayM: number;
}

export interface GeoFeature {
	geometry: { type: string; coordinates: unknown } | null;
	properties: Record<string, string>;
}

/**
 * Collects what each of `tracks` passes. Feed it the route ways (addWay) and the context features
 * (addFeature) in any order, then read the result with done().
 */
export function walkContext(tracks: LngLat[][]) {
	const samples: Sample[] = [];
	const cells = new Map<string, number[]>();
	const cellKey = (cx: number, cy: number) => `${cx}:${cy}`;
	tracks.forEach((track, walk) =>
		samplePoints(track).forEach(({ at, km }) => {
			const xy = project(at);
			const key = cellKey(Math.floor(xy[0] / CELL_M), Math.floor(xy[1] / CELL_M));
			if (!cells.has(key)) cells.set(key, []);
			cells.get(key)!.push(samples.length);
			samples.push({ walk, km, xy, cover: null, surface: null, wayM: Infinity });
		})
	);

	/** Samples in the box [x0, y0]–[x1, y1] (projected metres). */
	function* inBox(x0: number, y0: number, x1: number, y1: number) {
		for (let cx = Math.floor(x0 / CELL_M); cx <= Math.floor(x1 / CELL_M); cx++)
			for (let cy = Math.floor(y0 / CELL_M); cy <= Math.floor(y1 / CELL_M); cy++)
				for (const i of cells.get(cellKey(cx, cy)) ?? []) yield samples[i];
	}

	const places = tracks.map(() => new Map<string, { km: number; rank: number }>());
	const nature = tracks.map(() => new Map<string, number>());
	const sights = tracks.map(() => new Map<string, number>());
	const note = (map: Map<string, number>, name: string, km: number) => {
		if (!map.has(name) || km < map.get(name)!) map.set(name, km);
	};

	/** Nearest sample of each walk within `metres` of `xy`. */
	function nearest(xy: [number, number], metres: number) {
		const best = new Map<number, { km: number; d: number }>();
		for (const s of inBox(xy[0] - metres, xy[1] - metres, xy[0] + metres, xy[1] + metres)) {
			const d = Math.hypot(s.xy[0] - xy[0], s.xy[1] - xy[1]);
			if (d <= metres && d < (best.get(s.walk)?.d ?? Infinity)) best.set(s.walk, { km: s.km, d });
		}
		return best;
	}

	function addWay(line: LngLat[], tags: Record<string, string>) {
		const surface = surfaceOf(tags);
		const pts = line.map(project);
		for (let i = 1; i < pts.length; i++) {
			const [a, b] = [pts[i - 1], pts[i]];
			for (const s of inBox(
				Math.min(a[0], b[0]) - ON_WAY_M,
				Math.min(a[1], b[1]) - ON_WAY_M,
				Math.max(a[0], b[0]) + ON_WAY_M,
				Math.max(a[1], b[1]) + ON_WAY_M
			)) {
				const d = segmentDistance(s.xy, a, b);
				if (d <= ON_WAY_M && d < s.wayM) {
					s.wayM = d;
					s.surface = surface;
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
			for (const s of inBox(...bbox(rings[0]))) {
				if (!inRings(s.xy, rings)) continue;
				if (cover && (!s.cover || COVER_PRIORITY[cover] > COVER_PRIORITY[s.cover])) s.cover = cover;
				if (reserve) note(nature[s.walk], reserve, s.km);
			}
		}
	}

	/** Shares rounded to 10%: a small edit in OSM shouldn't change the page (and its lastmod). */
	const tenths = (n: number, total: number) => Math.round((n / total) * 10) * 10;
	const inOrder = (map: Map<string, number>, max: number) =>
		[...map]
			.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
			.slice(0, max)
			.map(([name]) => name);

	function done(): (WalkAlong | null)[] {
		const byWalk = tracks.map((): Sample[] => []);
		for (const s of samples) byWalk[s.walk].push(s);
		return byWalk.map((own, walk) => {
			if (!own.length) return null;
			const count = (pick: (s: Sample) => unknown) => own.filter(pick).length;
			const cover: WalkAlong['cover'] = {};
			for (const c of Object.keys(COVER_PRIORITY) as Cover[]) {
				const share = tenths(
					count((s) => s.cover === c),
					own.length
				);
				if (share) cover[c] = share;
			}
			// Villages before hamlets when there are too many, then back in walking order.
			const placeList = [...places[walk]]
				.sort((a, b) => a[1].rank - b[1].rank || a[1].km - b[1].km)
				.slice(0, MAX.places)
				.sort((a, b) => a[1].km - b[1].km || a[0].localeCompare(b[0]))
				.map(([name]) => name);
			return {
				places: placeList,
				nature: inOrder(nature[walk], MAX.nature),
				sights: inOrder(sights[walk], MAX.sights),
				cover,
				surface: {
					paved: tenths(
						count((s) => s.surface === 'paved'),
						own.length
					),
					unpaved: tenths(
						count((s) => s.surface === 'unpaved'),
						own.length
					)
				}
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
