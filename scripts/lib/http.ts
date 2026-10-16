import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RAW_DIR = process.env.RAW_CACHE_DIR ?? 'data/raw';
const USER_AGENT = 'Treinwandelaar/0.1 (personal, non-commercial walk planner)';
const MIN_INTERVAL_MS = 1000;
const REFRESH = process.argv.includes('--refresh');
/** Only the overview pages afresh: new and removed walks show up, known walks' pages stay cached. */
const REFRESH_LISTS = process.argv.includes('--refresh-lists');

let lastRequest = 0;
let oldest: Date | null = null;

/** When the oldest response this run used was downloaded: a cache hit is as old as its file. */
export function oldestFetch(): Date | null {
	return oldest;
}

function used(at: Date) {
	if (!oldest || at < oldest) oldest = at;
}

const cacheFile = (url: string, init: RequestInit) =>
	join(
		RAW_DIR,
		createHash('sha1')
			.update(url + (init.body ?? ''))
			.digest('hex')
	);

/** The cached response for this request, or null when it was never downloaded. */
export function readCached(url: string, init: RequestInit = {}): string | null {
	const file = cacheFile(url, init);
	if (!existsSync(file)) return null;
	used(statSync(file).mtime);
	return readFileSync(file, 'utf8');
}

/**
 * Fetch text with an on-disk cache and at most one request per second.
 * Raw responses are kept so parsers can be re-run without hitting the source again;
 * pass --refresh to re-download. `accept` can reject a 200 that is really an error, so it isn't cached.
 *
 * On --refresh a failed download falls back to the cached copy: a hiccup halfway through a run must
 * not make a walk look delisted (the ingests prune walks they didn't produce). Only a 404/410 means
 * the page is gone.
 */
export function fetchCached(
	url: string,
	init: RequestInit = {},
	accept: (text: string) => boolean = () => true
): Promise<string> {
	return fetchMaybeFresh(url, init, accept, REFRESH);
}

/**
 * An overview page, the one that says which walks (or stages) exist: like `fetchCached`, but also
 * downloaded afresh on --refresh-lists, so a light refresh finds new and delisted walks.
 */
export function fetchList(url: string): Promise<string> {
	return fetchMaybeFresh(url, {}, () => true, REFRESH || REFRESH_LISTS);
}

async function fetchMaybeFresh(
	url: string,
	init: RequestInit,
	accept: (text: string) => boolean,
	fresh: boolean
): Promise<string> {
	if (!fresh) {
		const cached = readCached(url, init);
		if (cached !== null) return cached;
		return download(url, init, accept);
	}
	try {
		return await download(url, init, accept);
	} catch (err) {
		const gone = err instanceof HttpError && (err.status === 404 || err.status === 410);
		const cached = gone ? null : readCached(url, init);
		if (cached === null) throw err;
		console.warn(`  ${(err as Error).message}; using the cached copy`);
		return cached;
	}
}

class HttpError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

async function download(
	url: string,
	init: RequestInit,
	accept: (text: string) => boolean
): Promise<string> {
	const file = cacheFile(url, init);
	const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	lastRequest = Date.now();

	const res = await fetch(url, {
		...init,
		headers: { 'User-Agent': USER_AGENT, ...init.headers }
	});
	if (!res.ok) throw new HttpError(`${res.status} ${res.statusText} for ${url}`, res.status);
	const text = await res.text();
	if (!accept(text)) throw new Error(`Unusable response for ${url}: ${text.slice(0, 200)}`);
	mkdirSync(RAW_DIR, { recursive: true });
	writeFileSync(file, text);
	used(new Date());
	return text;
}
