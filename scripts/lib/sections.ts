/**
 * Cut long-distance paths (streekpaden, LAW routes) into station-to-station day walks.
 *
 * A path is one long line. We find every place where it passes close to a station, then walk
 * along it greedily, picking the next station that makes a pleasant day (close to a target length).
 */
import { haversine, type LngLat } from '../../src/lib/geo';
import { DAY_WALK_KM } from '../../src/lib/walk';
import { compactGeometry } from './store';
import {
	WALKABLE_STATION_M,
	type PathStage,
	type PathStop,
	type Station
} from '../../src/lib/types';

export interface StationHit {
	code: string;
	/** Index of the path point closest to the station. */
	index: number;
	/** Distance from that point to the station, i.e. the walk to/from the platform. */
	metres: number;
	/** Distance along the path at `index`. */
	km: number;
}

export function cumulativeKm(path: LngLat[]): number[] {
	const km = [0];
	for (let i = 1; i < path.length; i++) km.push(km[i - 1] + haversine(path[i - 1], path[i]) / 1000);
	return km;
}

/**
 * Every pass of the path within `maxMetres` of a station. A path can pass the same station
 * more than once (circuits like the Betuwepad start and end in Tiel), so each contiguous run of
 * nearby points counts as its own hit.
 */
export function stationHits(path: LngLat[], stations: Station[], maxMetres: number): StationHit[] {
	const km = cumulativeKm(path);
	const margin = maxMetres / 60_000; // generous degrees for the bounding-box prefilter
	const lngs = path.map((p) => p[0]);
	const lats = path.map((p) => p[1]);
	const [minLng, maxLng] = [Math.min(...lngs) - margin * 1.7, Math.max(...lngs) + margin * 1.7];
	const [minLat, maxLat] = [Math.min(...lats) - margin, Math.max(...lats) + margin];

	const hits: StationHit[] = [];
	for (const s of stations) {
		if (s.lng < minLng || s.lng > maxLng || s.lat < minLat || s.lat > maxLat) continue;
		let best: StationHit | null = null;
		for (let i = 0; i < path.length; i++) {
			const metres = haversine(path[i], [s.lng, s.lat]);
			if (metres <= maxMetres) {
				if (!best || metres < best.metres) best = { code: s.code, index: i, metres, km: km[i] };
			} else if (best) {
				hits.push(best);
				best = null;
			}
		}
		if (best) hits.push(best);
	}

	// Two stations at nearly the same point along the path (e.g. Den Haag Centraal and HS): keep the closer.
	// And a path that wiggles past a station (in and out of range, three times past Vorden) passes it once.
	hits.sort((a, b) => a.index - b.index);
	const deduped: StationHit[] = [];
	for (const h of hits) {
		const prev = deduped.at(-1);
		const again = deduped.findLastIndex((d) => d.code === h.code && h.km - d.km < REPASS_KM);
		if (prev && h.km - prev.km < 0.5) {
			if (h.metres < prev.metres) deduped[deduped.length - 1] = h;
		} else if (again !== -1) {
			if (h.metres < deduped[again].metres) deduped.splice(again, deduped.length - again, h);
		} else deduped.push(h);
	}
	return deduped;
}

/** Passing the same station again within this many km along the path is the same pass. */
const REPASS_KM = 5;

export interface SectionOptions {
	minKm: number;
	targetKm: number;
	maxKm: number;
}

export const DEFAULT_SECTION: SectionOptions = {
	minKm: DAY_WALK_KM.min,
	targetKm: 15,
	maxKm: DAY_WALK_KM.max
};

/** Walking length of a section including the walk from/to the platforms. */
export const sectionKm = (a: StationHit, b: StationHit) =>
	b.km - a.km + (a.metres + b.metres) / 1000;

/**
 * Greedy, non-overlapping sections: from each station, jump to the station that gives the length
 * closest to the target; if no station is within range, try again from the next station.
 */
export function pickSections(
	hits: StationHit[],
	opts: SectionOptions = DEFAULT_SECTION
): [StationHit, StationHit][] {
	const sections: [StationHit, StationHit][] = [];
	let i = 0;
	while (i < hits.length - 1) {
		let best = -1;
		for (let j = i + 1; j < hits.length; j++) {
			const km = sectionKm(hits[i], hits[j]);
			if (km > opts.maxKm) break;
			if (km < opts.minKm || hits[j].code === hits[i].code) continue;
			if (
				best === -1 ||
				Math.abs(km - opts.targetKm) < Math.abs(sectionKm(hits[i], hits[best]) - opts.targetKm)
			)
				best = j;
		}
		if (best === -1) {
			i++;
			continue;
		}
		sections.push([hits[i], hits[best]]);
		i = best;
	}
	return sections;
}

export interface Stage<T> {
	data: T;
	track: LngLat[];
}

/**
 * Join stages into continuous lines. Stages are flipped when their GPX runs the other way, and a
 * new chain starts where consecutive stages don't connect (variants, missing stages, ferries).
 * Each point remembers which stage it came from.
 */
export function chainStages<T>(
	stages: Stage<T>[],
	maxGapMetres = 1000
): { path: LngLat[]; stageOf: number[] }[] {
	const chains: { path: LngLat[]; stageOf: number[] }[] = [];
	let current: { path: LngLat[]; stageOf: number[] } | null = null;
	stages.forEach((stage, s) => {
		if (stage.track.length < 2) return;
		let track = stage.track;
		const end = current?.path.at(-1);
		if (end) {
			const forward = haversine(end, track[0]);
			const reversed = haversine(end, track.at(-1)!);
			if (reversed < forward) track = [...track].reverse();
			if (Math.min(forward, reversed) > maxGapMetres) current = null;
		}
		if (!current) {
			current = { path: [], stageOf: [] };
			chains.push(current);
		}
		current.path.push(...track);
		current.stageOf.push(...track.map(() => s));
	});
	return chains;
}

export interface StageMeta {
	number: number;
	places: string | null;
	url: string;
}

/**
 * One line of a path as the planner stores it (see src/lib/path.ts): simplified stage by stage, so
 * every stage keeps its exact ends, with the stations it passes within walking distance. The stops'
 * indices and km are on the simplified line, which is what gets sliced into walks.
 */
export function plannerLine(
	chain: { path: LngLat[]; stageOf: number[] },
	stages: StageMeta[],
	stations: Station[],
	lineNo: number
): { line: LngLat[]; stops: PathStop[]; stages: PathStage[] } {
	const line: LngLat[] = [];
	const bounds: { stage: number; from: number; to: number }[] = [];
	for (let i = 0; i < chain.path.length;) {
		let j = i;
		while (j < chain.path.length && chain.stageOf[j] === chain.stageOf[i]) j++;
		const part = compactGeometry(chain.path.slice(i, j));
		bounds.push({ stage: chain.stageOf[i], from: line.length, to: line.length + part.length - 1 });
		line.push(...part);
		i = j;
	}
	const km = cumulativeKm(line);
	const round = (n: number) => Math.round(n * 100) / 100;
	const name = new Map(stations.map((s) => [s.code, s.name]));
	return {
		line,
		stops: stationHits(line, stations, WALKABLE_STATION_M).map((h) => ({
			key: h.code,
			code: h.code,
			name: name.get(h.code) ?? h.code,
			place: null,
			line: lineNo,
			index: h.index,
			km: round(h.km),
			metres: Math.round(h.metres)
		})),
		stages: bounds
			.filter((b) => stages[b.stage])
			.map((b) => ({
				...stages[b.stage],
				line: lineNo,
				fromKm: round(km[b.from]),
				toKm: round(km[b.to]),
				fromIndex: b.from,
				toIndex: b.to
			}))
	};
}
