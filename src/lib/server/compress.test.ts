import { describe, expect, it } from 'vitest';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { compress } from './compress';

const body = JSON.stringify({ geometry: Array.from({ length: 500 }, (_, i) => [5 + i / 1e4, 52]) });
const json = () => new Response(body, { headers: { 'content-type': 'application/json' } });
const asking = (encoding: string) =>
	new Request('http://localhost/', { headers: { 'accept-encoding': encoding } });

describe('compress', () => {
	it('prefers brotli, and the body still decodes to the same JSON', async () => {
		const res = compress(asking('gzip, deflate, br, zstd'), json());
		expect(res.headers.get('content-encoding')).toBe('br');
		expect(res.headers.get('vary')).toMatch(/Accept-Encoding/);
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.length).toBeLessThan(body.length / 2);
		expect(brotliDecompressSync(bytes).toString()).toBe(body);
	});

	it('falls back to gzip', async () => {
		const res = compress(asking('gzip'), json());
		expect(res.headers.get('content-encoding')).toBe('gzip');
		expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(body);
	});

	it('leaves the body alone for clients that ask for neither', async () => {
		const res = compress(asking(''), json());
		expect(res.headers.get('content-encoding')).toBeNull();
		expect(await res.text()).toBe(body);
	});

	it('skips small bodies and types that are compressed already', () => {
		const small = new Response('{}', {
			headers: { 'content-type': 'application/json', 'content-length': '2' }
		});
		expect(compress(asking('br'), small).headers.get('content-encoding')).toBeNull();
		const image = new Response(body, { headers: { 'content-type': 'image/jpeg' } });
		expect(compress(asking('br'), image).headers.get('content-encoding')).toBeNull();
	});
});
