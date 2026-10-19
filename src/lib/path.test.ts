import { describe, expect, it } from 'vitest';
import { parseStretchId, planStretch, stageList, stretchId } from './path';
import type { PathDetail, PathStop } from './types';

const stop = (code: string, index: number, km: number, line = 0): PathStop => ({
	key: code,
	code,
	name: code,
	place: null,
	line,
	index,
	km,
	metres: 500
});

// Ten points 1 km apart; a circuit that passes T at both ends; a second line after a ferry.
const path: PathDetail = {
	id: 'pad:test',
	name: 'Testpad',
	source: 'wandelnet',
	collection: 'law',
	km: 9,
	lines: [Array.from({ length: 10 }, (_, i): [number, number] => [5 + i * 0.0146, 52]), [[6, 52]]],
	stops: [stop('T', 0, 0), stop('A', 3, 3), stop('B', 7, 7), stop('T', 9, 9), stop('F', 0, 0, 1)],
	stages: [
		{
			number: 1,
			places: 'T – X',
			line: 0,
			fromKm: 0,
			toKm: 5,
			fromIndex: 0,
			toIndex: 5,
			url: 'u1'
		},
		{ number: 2, places: 'X – T', line: 0, fromKm: 5, toKm: 9, fromIndex: 5, toIndex: 9, url: 'u2' }
	],
	sourceUrl: 'u'
};

describe('stretch ids', () => {
	it('round-trips path id and station codes', () => {
		const id = stretchId('pad:pieterpad-deel-1', 'WSM', 'GN');
		expect(id).toBe('pad:pieterpad-deel-1:WSM-GN');
		expect(parseStretchId(id)).toEqual({ pathId: 'pad:pieterpad-deel-1', from: 'WSM', to: 'GN' });
	});

	it('takes stage ends reached by bus', () => {
		expect(parseStretchId('pad:pieterpad-deel-1:e3-GN')).toEqual({
			pathId: 'pad:pieterpad-deel-1',
			from: 'e3',
			to: 'GN'
		});
		expect(parseStretchId('osm:123:s0-e12')?.to).toBe('e12');
	});

	it('rejects ids that are no stretch', () => {
		expect(parseStretchId('wandelnet:123')).toBeNull();
		expect(parseStretchId('pad:x:UT-UT')).toBeNull();
	});
});

describe('planStretch', () => {
	it('slices the line between two stops and counts the walks to the platforms', () => {
		const s = planStretch(path, 'A', 'B')!;
		expect(s.track).toHaveLength(5);
		expect(s.km).toBe(5); // 4 km along the path plus 2 × 500 m
		expect(s.stages.map((st) => st.number)).toEqual([1, 2]);
		expect(s.reversed).toBe(false);
	});

	it('walks the path backwards when you ask for it', () => {
		const s = planStretch(path, 'B', 'A')!;
		expect(s.reversed).toBe(true);
		expect(s.track[0]).toEqual(path.lines[0][7]);
		expect(s.stages.map((st) => st.number)).toEqual([2, 1]);
	});

	it('takes the nearest pass of a station the path passes twice', () => {
		expect(planStretch(path, 'B', 'T')!.to.index).toBe(9);
		expect(planStretch(path, 'T', 'A')!.from.index).toBe(0);
	});

	it('counts no walk to the platform at a stage end, where the bus stops in the village', () => {
		const withBus: PathDetail = {
			...path,
			stops: [...path.stops, { ...stop('Z', 5, 5), key: 'e0', place: 'X', metres: 9000 }]
		};
		const s = planStretch(withBus, 'A', 'e0')!;
		expect(s.km).toBe(2.5); // 2 km along the path plus 500 m to A's platform
		expect(s.to.place).toBe('X');
	});

	it("doesn't connect stops on separate lines, or stations off the path", () => {
		expect(planStretch(path, 'A', 'F')).toBeNull();
		expect(planStretch(path, 'A', 'UT')).toBeNull();
	});
});

describe('stageList', () => {
	it('names one stage or several', () => {
		expect(stageList(path.stages.slice(0, 1))).toBe('etappe 01 (T – X)');
		expect(stageList(path.stages)).toBe('etappes 01 (T – X) en 02 (X – T)');
	});
});
