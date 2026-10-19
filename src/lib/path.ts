/**
 * Your own stretch of a LAW route or streekpad: from any station it passes to any other, in either
 * direction. The ingest cuts each path into a handful of day walks; this plans the rest on request,
 * under the walk id '<path id>:<from>-<to>' those day walks use too. A stop is a station code, or a
 * stage end that a bus runs to ('e3', the end of the path's fourth stage: see PathStop.key).
 */
import type { LngLat } from './geo';
import type { PathDetail, PathStage, PathStop } from './types';

export const stretchId = (pathId: string, from: string, to: string) => `${pathId}:${from}-${to}`;

/** A stage end reached by bus: its key, as in a stretch id. */
export const isStageEnd = (key: string) => /^[se]\d+$/.test(key);

/** 'pad:pieterpad-deel-1:WSM-GN', 'pad:pieterpad-deel-1:GN-e3' → the path and the two stop keys. */
export function parseStretchId(id: string): { pathId: string; from: string; to: string } | null {
	const m = /^(.+):([A-Z0-9]+|[se]\d+)-([A-Z0-9]+|[se]\d+)$/.exec(id);
	return m && m[2] !== m[3] ? { pathId: m[1], from: m[2], to: m[3] } : null;
}

/** The walk between path and platform; at a stage end the bus stops in the village itself. */
const platformKm = (s: PathStop) => (s.place ? 0 : s.metres / 1000);

/** Walking length including the walks between the path and the platforms, as the ingest counts it. */
export const stretchKm = (a: PathStop, b: PathStop) =>
	Math.round((Math.abs(b.km - a.km) + platformKm(a) + platformKm(b)) * 10) / 10;

export interface Stretch {
	from: PathStop;
	to: PathStop;
	/** The route line from `from` to `to`, turned around when you walk the path backwards. */
	track: LngLat[];
	km: number;
	/** The path's own stages this stretch runs along (more than a few hundred metres of). */
	stages: PathStage[];
	reversed: boolean;
}

/**
 * From stop `from` to stop `to` (keys), on the same line, in either direction. A path that passes a
 * station twice takes the pair of passes closest together. Null when the path doesn't connect them.
 */
export function planStretch(path: PathDetail, from: string, to: string): Stretch | null {
	let best: { a: PathStop; b: PathStop } | null = null;
	for (const a of path.stops.filter((s) => s.key === from))
		for (const b of path.stops.filter((s) => s.key === to && s.line === a.line))
			if (!best || Math.abs(b.km - a.km) < Math.abs(best.b.km - best.a.km)) best = { a, b };
	if (!best) return null;
	const { a, b } = best;
	const reversed = b.index < a.index;
	const [lo, hi] = reversed ? [b, a] : [a, b];
	const track = path.lines[a.line].slice(lo.index, hi.index + 1) as LngLat[];
	const stages = path.stages.filter(
		(s) => s.line === a.line && Math.min(s.toKm, hi.km) - Math.max(s.fromKm, lo.km) > 0.3
	);
	return {
		from: a,
		to: b,
		track: reversed ? track.reverse() : track,
		km: stretchKm(a, b),
		stages: reversed ? stages.reverse() : stages,
		reversed
	};
}

const twoDigits = (n: number) => String(n).padStart(2, '0');

/** "etappe 03 (Pieterburen – Winsum)" or "etappes 03, 04 en 05". */
export function stageList(stages: PathStage[]): string {
	const names = stages.map((s) =>
		s.places ? `${twoDigits(s.number)} (${s.places})` : twoDigits(s.number)
	);
	if (names.length < 2) return names.map((n) => `etappe ${n}`).join('');
	return `etappes ${names.slice(0, -1).join(', ')} en ${names.at(-1)}`;
}
