import { describe, expect, it } from 'vitest';
import type { LngLat } from '../../src/lib/geo';
import { alongOf } from '../../src/lib/along';
import { coverOf, samplePoints, sightOf, surfaceOf, walkContext } from './context';

// A walk 2 km due east along 52° N, from 5.000 to ~5.029.
const track: LngLat[] = [
	[5.0, 52.0],
	[5.0292, 52.0]
];
const square = (lng0: number, lng1: number, lat0 = 51.99, lat1 = 52.01) => ({
	type: 'Polygon',
	coordinates: [
		[
			[lng0, lat0],
			[lng1, lat0],
			[lng1, lat1],
			[lng0, lat1],
			[lng0, lat0]
		]
	]
});

describe('what a walk passes', () => {
	it('samples a track every 50 m', () => {
		const s = samplePoints(track);
		// 1999 m: 0, 50, … 1950.
		expect(s.length).toBe(40);
		expect(s.at(-1)!.km).toBeCloseTo(1.95, 5);
	});

	it('reads surface from the tags, or from the kind of way', () => {
		expect(surfaceOf({ highway: 'path', surface: 'ground' })).toBe('unpaved');
		expect(surfaceOf({ highway: 'footway', surface: 'paving_stones:30' })).toBe('paved');
		expect(surfaceOf({ highway: 'residential' })).toBe('paved');
		expect(surfaceOf({ highway: 'track', tracktype: 'grade3' })).toBe('unpaved');
		expect(surfaceOf({ highway: 'path' })).toBeNull();
	});

	it('names landscapes and sights', () => {
		expect(coverOf({ natural: 'wood' })).toBe('forest');
		expect(coverOf({ landuse: 'farmland' })).toBeNull();
		expect(sightOf({ man_made: 'windmill', name: 'De Hoop' })).toBe('molen De Hoop');
		expect(sightOf({ historic: 'windmill', name: 'Molen De Hoop' })).toBe('Molen De Hoop');
		expect(sightOf({ historic: 'castle', name: 'Kasteel Doorwerth' })).toBe('Kasteel Doorwerth');
		expect(sightOf({ historic: 'castle' })).toBeNull();
	});

	it('collects places, nature, sights, landscape and surface along the walk', () => {
		const other: LngLat[] = [
			[6, 53],
			[6.01, 53]
		];
		const c = walkContext([track, other]);
		// The first half on an unpaved path, the rest on a road; the road is mapped twice.
		c.addWay(
			[
				[5.0, 52.0],
				[5.0146, 52.0]
			],
			{ highway: 'path', surface: 'sand' }
		);
		c.addWay(
			[
				[5.0146, 52.0001],
				[5.0292, 52.0001]
			],
			{ highway: 'residential' }
		);
		c.addFeature({
			geometry: { type: 'Point', coordinates: [5.02, 52.004] },
			properties: { place: 'village', name: 'Later' }
		});
		c.addFeature({
			geometry: { type: 'Point', coordinates: [5.005, 52.003] },
			properties: { place: 'village', name: 'Eerder' }
		});
		// A hamlet too far off to count.
		c.addFeature({
			geometry: { type: 'Point', coordinates: [5.01, 52.01] },
			properties: { place: 'hamlet', name: 'Ver' }
		});
		c.addFeature({
			geometry: square(4.99, 5.0146),
			properties: { natural: 'wood', leisure: 'nature_reserve', name: 'Het Bos' }
		});
		// Heath inside the wood wins where they overlap.
		c.addFeature({ geometry: square(5.0, 5.0073), properties: { natural: 'heath' } });
		c.addFeature({
			geometry: { type: 'Point', coordinates: [5.025, 52.0005] },
			properties: { man_made: 'windmill', name: 'De Hoop' }
		});
		const profiles = c.done();
		const [mine, theirs] = profiles.map((p) => alongOf(p));
		expect(mine).toEqual({
			places: ['Eerder', 'Later'],
			nature: ['Het Bos'],
			sights: ['molen De Hoop'],
			cover: { heath: 30, forest: 30 },
			surface: { paved: 50, unpaved: 50 }
		});
		// A stretch of it: only what lies between its km, in its own walking order.
		expect(profiles[0].cover).toMatch(/^h{10}f{10}-{20}$/);
		// Walked backwards: the places come the other way round.
		expect(alongOf(profiles[0], 1.95, 0).places).toEqual(['Later', 'Eerder']);
		expect(alongOf(profiles[0], 0.5, 1.95)).toMatchObject({
			places: ['Later'],
			cover: { forest: 30 },
			sights: ['molen De Hoop']
		});
		expect(alongOf(profiles[0], 0, 0.5).sights).toEqual([]);
		expect(theirs).toMatchObject({
			places: [],
			nature: [],
			cover: {},
			surface: { paved: 0, unpaved: 0 }
		});
	});
});
