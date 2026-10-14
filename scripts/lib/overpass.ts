import { fetchCached, readCached } from './http';

/**
 * Public Overpass servers, tried in order; overpass-api.de is often busy (504) at peak times.
 * Not overpass.private.coffee: in October 2026 it served July data and answered area queries with
 * nothing at all.
 */
const ENDPOINTS = [
	'https://overpass-api.de/api/interpreter',
	'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter'
];

/** A mirror whose data is older than this is lagging; its (possibly empty) answers aren't cached. */
const MAX_AGE_DAYS = 7;

/**
 * Whether an answer is worth caching. Overpass reports a query that ran out of time or memory as a
 * 200 with a `remark` and possibly partial data, and a lagging mirror answers from old data.
 */
export function complete(text: string, now = new Date()): boolean {
	if (!text.trimStart().startsWith('{')) return false;
	if (/"remark":\s*"runtime (error|remark)/.test(text)) return false;
	const base = /"timestamp_osm_base":\s*"([^"]+)"/.exec(text)?.[1];
	return !!base && now.getTime() - Date.parse(base) < MAX_AGE_DAYS * 24 * 3600_000;
}

const request = (query: string): RequestInit => ({
	method: 'POST',
	body: new URLSearchParams({ data: query }).toString(),
	headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
});

/** A query's answer from the download cache, whichever server gave it; null if none did yet. */
export function cachedOverpass(query: string): string | null {
	for (const endpoint of ENDPOINTS) {
		const text = readCached(endpoint, request(query));
		if (text !== null) return text;
	}
	return null;
}

/** Run an Overpass QL query (cached like every other download), trying each server in turn. */
export async function queryOverpass(query: string): Promise<string> {
	const cached = process.argv.includes('--refresh') ? null : cachedOverpass(query);
	if (cached !== null) return cached;
	const errors: string[] = [];
	for (let round = 1; round <= ROUNDS; round++) {
		for (const endpoint of ENDPOINTS) {
			try {
				return await fetchCached(endpoint, request(query), (text) => complete(text));
			} catch (err) {
				errors.push((err as Error).message.slice(0, 120));
			}
		}
		// All busy (504/429 under load): give them a while before the next round.
		if (round < ROUNDS) await new Promise((r) => setTimeout(r, round * 60_000));
	}
	throw new Error(
		`All Overpass servers failed:\n  ${errors.slice(-ENDPOINTS.length).join('\n  ')}`
	);
}

/** Rounds over all servers before giving up; with the waits in between that is about 15 minutes. */
const ROUNDS = 5;
