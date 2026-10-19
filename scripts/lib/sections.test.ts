import { describe, expect, it } from 'vitest';
import type { LngLat } from '../../src/lib/geo';
import { chainStages, pickSections, sectionKm, stationHits } from './sections';

// A straight east-west line at 52°N: 0.01° of longitude ≈ 0.685 km.
const line = (fromLng: number, toLng: number, step = 0.001): LngLat[] => {
	const pts: LngLat[] = [];
	for (let lng = fromLng; lng <= toLng + 1e-9; lng += step) pts.push([lng, 52]);
	return pts;
};
const station = (code: string, lng: number, latOffset = 0.003) => ({
	code,
	uic: null,
	name: code,
	lng,
	lat: 52 + latOffset // ~330 m north of the path
});

describe('stationHits', () => {
	it('finds stations near the path, in path order, with the walk to the platform', () => {
		const path = line(5, 5.5);
		const hits = stationHits(
			path,
			[station('B', 5.3), station('A', 5.1), station('FAR', 5.2, 0.05)],
			1000
		);
		expect(hits.map((h) => h.code)).toEqual(['A', 'B']);
		expect(hits[0].metres).toBeGreaterThan(300);
		expect(hits[0].metres).toBeLessThan(360);
	});

	it('counts a station twice when a circuit passes it at start and end', () => {
		const out = line(5, 5.2);
		const path = [...out, ...[...out].reverse()];
		const hits = stationHits(path, [station('T', 5.0)], 1000);
		expect(hits.map((h) => h.index)).toEqual([0, path.length - 1]);
	});

	it('counts a path that wiggles in and out of range of a station as one pass, the closest', () => {
		// East past V at ~330 m, out of range round a bend, then back west past V at ~70 m.
		const bend: LngLat[] = [];
		for (let lat = 52; lat <= 52.005 + 1e-9; lat += 0.001) bend.push([5.12, lat]);
		const path: LngLat[] = [
			...line(5, 5.12),
			...bend,
			...[...line(5.08, 5.12)].reverse().map(([lng]): LngLat => [lng, 52.0024])
		];
		const hits = stationHits(path, [station('V', 5.105)], 1000);
		expect(hits).toHaveLength(1);
		expect(hits[0].metres).toBeLessThan(100);
	});
});

describe('pickSections', () => {
	it('picks station pairs close to the target length without overlap', () => {
		// Stations every ~3.4 km along a 34 km line.
		const path = line(5, 5.5);
		const stations = Array.from({ length: 11 }, (_, i) => station(`S${i}`, 5 + i * 0.05));
		const sections = pickSections(stationHits(path, stations, 1000));
		expect(sections.length).toBe(2);
		for (const [a, b] of sections) {
			expect(sectionKm(a, b)).toBeGreaterThanOrEqual(8);
			expect(sectionKm(a, b)).toBeLessThanOrEqual(26);
		}
		expect(sections[0][1]).toBe(sections[1][0]); // the second starts where the first ended
	});

	it('skips stretches with no station in walking range', () => {
		const path = line(5, 6);
		// 0 → 0.6° (41 km) is too long; 0.6 → 0.8 (13.7 km) works.
		const hits = stationHits(path, [station('A', 5), station('B', 5.6), station('C', 5.8)], 1000);
		expect(pickSections(hits).map(([a, b]) => `${a.code}-${b.code}`)).toEqual(['B-C']);
	});
});

describe('chainStages', () => {
	it('flips reversed stages and splits on gaps', () => {
		const s1 = line(5, 5.1);
		const s2 = [...line(5.1, 5.2)].reverse(); // drawn the other way
		const s3 = line(5.5, 5.6); // 20 km gap
		const chains = chainStages([s1, s2, s3].map((track, i) => ({ data: i, track })));
		expect(chains).toHaveLength(2);
		expect(chains[0].path.at(-1)?.[0]).toBeCloseTo(5.2, 5);
		expect(new Set(chains[0].stageOf)).toEqual(new Set([0, 1]));
		expect(chains[1].stageOf.every((s) => s === 2)).toBe(true);
	});
});
