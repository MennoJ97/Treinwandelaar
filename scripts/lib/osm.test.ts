import { describe, expect, it } from 'vitest';
import { lineLengthKm } from '../../src/lib/geo';
import {
	classify,
	isClosed,
	isNsWalk,
	rotateLoop,
	stageOf,
	stitch,
	routeIndex,
	type OsmRelation
} from './osm';
import { complete } from './overpass';

// Hand-written relations in the shape of Overpass `out geom` (no real OSM data in the repo).
const way = (role: string, ...pts: [number, number][]) => ({
	type: 'way' as const,
	ref: 1,
	role,
	geometry: pts.map(([lon, lat]) => ({ lat, lon }))
});
const rel = (tags: Record<string, string>, members: OsmRelation['members'] = []): OsmRelation => ({
	type: 'relation',
	id: 1,
	tags: { type: 'route', route: 'hiking', ...tags },
	members
});

describe('isNsWalk', () => {
	it('spots NS walks by name or operator', () => {
		expect(isNsWalk({ name: 'NS-wandeling Lange Duinen', operator: 'Wandelnet' })).toBe(true);
		expect(isNsWalk({ name: 'NS-wandeltocht Amelisweerd', operator: 'NS;LAW' })).toBe(true);
		expect(isNsWalk({ name: 'Waterlinie Culemborg', operator: 'NS' })).toBe(true);
		expect(isNsWalk({ name: 'Hollandse Kade', operator: 'LAW / NS' })).toBe(true);
	});

	it("doesn't take a station in the name for an NS walk", () => {
		expect(isNsWalk({ name: 'Rondom de Dom part 6 - Hollandsche Rading NS - Soestduinen' })).toBe(
			false
		);
		expect(isNsWalk({ name: 'Marskramerpad - 14', operator: 'Wandelnet' })).toBe(false);
		expect(isNsWalk({ name: 'Klompenpad', operator: 'Landschap Erfgoed Utrecht' })).toBe(false);
	});
});

describe('classify', () => {
	it('maps the hiking networks to collections', () => {
		expect(classify(rel({ network: 'nwn', name: 'Floris V-pad - 03' }))).toBe('law');
		expect(classify(rel({ network: 'rwn', name: 'Groene Hartpad - 02' }))).toBe('streekpad');
		expect(classify(rel({ network: 'lwn', name: 'Ommetje Lage Vuursche' }))).toBe('lokaal');
	});

	it('skips NS walks, knooppunt links and other route types', () => {
		expect(classify(rel({ network: 'lwn', name: 'NS-wandeling Lange Duinen' }))).toBeNull();
		expect(classify(rel({ network: 'rwn', name: '22-99' }))).toBeNull();
		expect(classify(rel({ network: 'lwn' }))).toBeNull();
		expect(classify(rel({ network: 'lcn', name: 'Fietsroute', route: 'bicycle' }))).toBeNull();
	});
});

describe('stageOf', () => {
	it('splits LAW/streekpad stage names', () => {
		expect(stageOf('Marskramerpad - 14')).toEqual({ path: 'Marskramerpad', stage: 14 });
		expect(stageOf('Floris V-pad - 03')).toEqual({ path: 'Floris V-pad', stage: 3 });
		expect(stageOf('Ommetje Lage Vuursche')).toBeNull();
	});
});

describe('stitch', () => {
	it('joins ways in member order, flipping the ones drawn the other way', () => {
		const lines = stitch(
			rel({}, [
				way('', [5.01, 52], [5.0, 52]), // first way drawn backwards
				way('', [5.01, 52], [5.02, 52]),
				way('', [5.03, 52], [5.02, 52]) // and this one too
			])
		);
		expect(lines).toHaveLength(1);
		expect(lines[0].map((p) => p[0])).toEqual([5.0, 5.01, 5.02, 5.03]);
	});

	it('starts a new line at a gap and leaves out side branches', () => {
		const lines = stitch(
			rel({}, [
				way('', [5.0, 52], [5.01, 52]),
				way('alternative', [5.01, 52], [5.01, 52.01]),
				way('', [5.05, 52], [5.06, 52])
			])
		);
		expect(lines.map((l) => l.length)).toEqual([2, 2]);
	});
});

describe('loops', () => {
	const square: [number, number][] = [
		[5, 52],
		[5.01, 52],
		[5.01, 52.01],
		[5, 52.01],
		[5, 52]
	];

	it('recognises a closed line', () => {
		expect(isClosed(square)).toBe(true);
		expect(isClosed(square.slice(0, 4))).toBe(false);
	});

	it('rotates a loop to start at another point without changing its length', () => {
		const rotated = rotateLoop(square, 2);
		expect(rotated[0]).toEqual([5.01, 52.01]);
		expect(rotated.at(-1)).toEqual([5.01, 52.01]);
		expect(lineLengthKm(rotated)).toBeCloseTo(lineLengthKm(square), 6);
	});
});

describe('routeIndex', () => {
	// East-west lines at 52°N; 0.001° of latitude ≈ 111 m.
	const along = (lat: number, from = 5, to = 5.1): [number, number][] => {
		const pts: [number, number][] = [];
		for (let lng = from; lng <= to + 1e-9; lng += 0.005) pts.push([lng, lat]);
		return pts;
	};
	const shared = routeIndex([along(52)]);

	it('sees a walk on the same paths as covered', () => {
		expect(shared(along(52.0003))).toBe(1); // ~33 m off: the other side of the road
	});

	it('sees a parallel walk a few hundred metres away as different', () => {
		expect(shared(along(52.004))).toBe(0);
	});

	it('measures a partial overlap', () => {
		const half = [...along(52, 5.05, 5.1), ...along(52.01, 5.1, 5.15)];
		expect(shared(half)).toBeGreaterThan(0.4);
		expect(shared(half)).toBeLessThan(0.6);
	});
});

describe('complete (Overpass answers worth caching)', () => {
	const answer = (base: string, extra = '') =>
		`{"osm3s": {"timestamp_osm_base": "${base}"}, ${extra} "elements": []}`;
	const now = new Date('2026-10-14T20:00:00Z');

	it('accepts a current answer, even an empty one', () => {
		expect(complete(answer('2026-10-14T18:00:00Z'), now)).toBe(true);
	});

	it('rejects a lagging mirror, a timeout and an error page', () => {
		expect(complete(answer('2026-07-15T15:22:01Z'), now)).toBe(false);
		expect(
			complete(answer('2026-10-14T18:00:00Z', '"remark": "runtime error: Query timed out",'), now)
		).toBe(false);
		expect(complete('<html>504 Gateway Timeout</html>', now)).toBe(false);
	});
});
