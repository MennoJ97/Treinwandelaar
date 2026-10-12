import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RAW_DIR = process.env.RAW_CACHE_DIR ?? 'data/raw';
const USER_AGENT = 'Treinwandelaar/0.1 (personal, non-commercial walk planner)';
const MIN_INTERVAL_MS = 1000;
const REFRESH = process.argv.includes('--refresh');

let lastRequest = 0;

/**
 * Fetch text with an on-disk cache and at most one request per second.
 * Raw responses are kept so parsers can be re-run without hitting the source again;
 * pass --refresh to re-download.
 */
export async function fetchCached(url: string, init: RequestInit = {}): Promise<string> {
	const file = join(
		RAW_DIR,
		createHash('sha1')
			.update(url + (init.body ?? ''))
			.digest('hex')
	);
	if (!REFRESH && existsSync(file)) return readFileSync(file, 'utf8');

	const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	lastRequest = Date.now();

	const res = await fetch(url, {
		...init,
		headers: { 'User-Agent': USER_AGENT, ...init.headers }
	});
	if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
	const text = await res.text();
	mkdirSync(RAW_DIR, { recursive: true });
	writeFileSync(file, text);
	return text;
}
