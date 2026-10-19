import type { Cover, WalkAlong } from './types';

/**
 * What a line passes, every PROFILE_STEP_KM along it, as the OSM ingest found it
 * (scripts/lib/context.ts): for a stored walk, and for each line of a whole path, so that a stretch
 * planned on request can say what it passes too (alongOf with its km range).
 */
export interface AlongProfile {
	/** One character per step: f(orest), h(eath), d(unes, sand), b(uilt-up) or '-'. */
	cover: string;
	/** One character per step: p(aved), u(npaved) or '-' (not known). */
	surface: string;
	/** Towns and villages: name, km of the nearest point, rank (0 city … 3 hamlet). */
	places: [string, number, number][];
	/** Named nature areas: name and the stretches inside it, from and to km. */
	nature: [string, number, number][];
	/** Named sights: name, km of the nearest point. */
	sights: [string, number][];
}

export const PROFILE_STEP_KM = 0.05;

// In this order in the stored JSON: walks.along compares as text, so changing it moves lastmods.
const COVER_CODES: Record<string, Cover> = { d: 'dunes', h: 'heath', f: 'forest', b: 'builtUp' };
export const coverCode = (c: Cover | null) =>
	c ? Object.keys(COVER_CODES).find((k) => COVER_CODES[k] === c)! : '-';

const MAX = { places: 8, nature: 5, sights: 6 };

/** Shares rounded to 10%: a small edit in OSM shouldn't change the page (and its lastmod). */
const tenths = (n: number, total: number) => (total ? Math.round((n / total) * 10) * 10 : 0);

/**
 * What the line passes between `fromKm` and `toKm` (the whole line by default), in walking order:
 * a `fromKm` past `toKm` walks it backwards.
 */
export function alongOf(p: AlongProfile, fromKm = 0, toKm = Infinity): WalkAlong {
	const reversed = fromKm > toKm;
	const [lo, hi] = reversed ? [toKm, fromKm] : [fromKm, toKm];
	const first = Math.max(0, Math.ceil(lo / PROFILE_STEP_KM - 1e-9));
	const last = Math.min(p.cover.length - 1, Math.floor(hi / PROFILE_STEP_KM + 1e-9));
	const cover = p.cover.slice(first, last + 1);
	const surface = p.surface.slice(first, last + 1);
	const count = (s: string, c: string) => s.split(c).length - 1;
	const shares: WalkAlong['cover'] = {};
	for (const [code, kind] of Object.entries(COVER_CODES)) {
		const share = tenths(count(cover, code), cover.length);
		if (share) shares[kind] = share;
	}
	const order = (km: number) => (reversed ? -km : km);
	const inRange = (km: number) => km >= lo - PROFILE_STEP_KM && km <= hi + PROFILE_STEP_KM;
	// Villages before hamlets when there are too many, then back in walking order.
	const places = p.places
		.filter(([, km]) => inRange(km))
		.sort((a, b) => a[2] - b[2] || order(a[1]) - order(b[1]))
		.slice(0, MAX.places)
		.sort((a, b) => order(a[1]) - order(b[1]) || a[0].localeCompare(b[0]))
		.map(([name]) => name);
	// A nature area by where the walk enters it.
	const entered = new Map<string, number>();
	for (const [name, from, to] of p.nature)
		if (to >= lo && from <= hi) {
			const at = order(reversed ? Math.min(to, hi) : Math.max(from, lo));
			if (!entered.has(name) || at < entered.get(name)!) entered.set(name, at);
		}
	const nature = [...entered]
		.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
		.slice(0, MAX.nature)
		.map(([name]) => name);
	const sights = p.sights
		.filter(([, km]) => inRange(km))
		.sort((a, b) => order(a[1]) - order(b[1]) || a[0].localeCompare(b[0]))
		.slice(0, MAX.sights)
		.map(([name]) => name);
	return {
		places,
		nature,
		sights,
		cover: shares,
		surface: {
			paved: tenths(count(surface, 'p'), surface.length),
			unpaved: tenths(count(surface, 'u'), surface.length)
		}
	};
}
