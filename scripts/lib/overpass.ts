import { fetchCached, readCached } from './http';

/** Public Overpass servers, tried in order; overpass-api.de is often busy (504) at peak times. */
const ENDPOINTS = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.private.coffee/api/interpreter',
	'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter'
];

/**
 * Overpass reports a query that ran out of time or memory as a 200 with a `remark`, and possibly
 * partial data: don't cache that.
 */
const complete = (text: string) =>
	text.trimStart().startsWith('{') && !/"remark":\s*"runtime (error|remark)/.test(text);

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
				return await fetchCached(endpoint, request(query), complete);
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
