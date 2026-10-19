import { describe, expect, it } from 'vitest';
import { buildRailNetwork, legLine } from './railMap';

const track = (from: string, to: string, coordinates: number[][]) => ({
	type: 'Feature',
	properties: { from, to },
	geometry: { type: 'LineString', coordinates }
});

// A ─ B ─ C along the bottom, and a long way round from A over D to C.
const network = buildRailNetwork([
	track('a', 'b', [
		[5.0, 52.0],
		[5.05, 52.002]
	]),
	track('c', 'b', [
		[5.1, 52.0],
		[5.05, 52.002]
	]),
	track('a', 'd', [
		[5.0, 52.0],
		[5.05, 52.2]
	]),
	track('d', 'c', [
		[5.05, 52.2],
		[5.1, 52.0]
	]),
	track('x', 'y', [
		[6.0, 52.0],
		[6.1, 52.0]
	])
]);

const A = { code: 'A', at: [5.0, 52.0] as [number, number] };
const C = { code: 'C', at: [5.1, 52.0] as [number, number] };

describe('rail network', () => {
	it('takes the shortest way over the tracks, either way along a track', () => {
		expect(legLine(network, [A, C])).toEqual([
			[5.0, 52.0],
			[5.05, 52.002],
			[5.1, 52.0]
		]);
		expect(legLine(network, [C, A])).toEqual([
			[5.1, 52.0],
			[5.05, 52.002],
			[5.0, 52.0]
		]);
	});

	it('goes straight where the network has no way or no station', () => {
		const X = { code: 'X', at: [6.0, 52.0] as [number, number] };
		const abroad = { code: null, at: [7.0, 52.5] as [number, number] };
		expect(legLine(network, [A, X])).toEqual([A.at, X.at]);
		expect(legLine(network, [A, abroad])).toEqual([A.at, abroad.at]);
		expect(legLine(null, [A, C])).toEqual([A.at, C.at]);
	});

	it('distrusts a way over the tracks far longer than the straight line', () => {
		// Without B, A to C runs 45 km round over D for 7 km as the crow flies.
		const roundabout = buildRailNetwork([
			track('a', 'd', [
				[5.0, 52.0],
				[5.05, 52.2]
			]),
			track('d', 'c', [
				[5.05, 52.2],
				[5.1, 52.0]
			])
		]);
		expect(legLine(roundabout, [A, C])).toEqual([A.at, C.at]);
	});
});
