import { describe, expect, it } from 'vitest';
import { parseRoutesOpl } from './extract';
import { classify, stitch } from './osm';

// Hand-written OPL in the shape `osmium add-locations-to-ways -f opl` writes (no real OSM data).
const OPL = [
	'w10 v3 dV c1 t2026-01-01T00:00:00Z i1 uA T Nn1x5.1000000y52.0000000,n2x5.1100000y52.0000000',
	'w11 v1 dV c1 t2026-01-01T00:00:00Z i1 uA Thighway=path Nn2x5.1100000y52.0000000,n3x5.1200000y52.0100000',
	'r20 v5 dV c1 t2026-01-01T00:00:00Z i1 uA Ttype=route,route=hiking,network=lwn,name=Ommetje%20%Lage%20%Vuursche,operator=Staatsbosbeheer Mw10@,w11@,n7@guidepost'
].join('\n');

describe('parseRoutesOpl', () => {
	const [rel] = parseRoutesOpl(OPL);

	it('reads tags, unescaping OPL', () => {
		expect(rel.id).toBe(20);
		expect(rel.tags.name).toBe('Ommetje Lage Vuursche');
		expect(classify(rel)).toBe('lokaal');
	});

	it('attaches way geometry to the members, as Overpass `out geom` does', () => {
		expect(rel.members.map((m) => [m.type, m.ref, m.role])).toEqual([
			['way', 10, ''],
			['way', 11, ''],
			['node', 7, 'guidepost']
		]);
		expect(stitch(rel)[0]).toEqual([
			[5.1, 52],
			[5.11, 52],
			[5.12, 52.01]
		]);
	});
});
