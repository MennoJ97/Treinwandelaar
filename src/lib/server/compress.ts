import { Duplex } from 'node:stream';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';

const COMPRESSIBLE = /json|javascript|xml|svg|^text\//;
/** Below this a compressed body saves less than the headers and the work cost. */
const MIN_BYTES = 1024;

/**
 * Pages, their data and the API answer in JSON full of coordinates, which shrinks to a fraction.
 * adapter-node already serves the built assets precompressed, but not what SvelteKit renders.
 * Brotli at a middle quality: the top settings take seconds on megabytes, for a few percent more.
 */
export function compress(request: Request, response: Response): Response {
	const type = response.headers.get('content-type') ?? '';
	const length = Number(response.headers.get('content-length') ?? Infinity);
	if (
		!response.body ||
		response.headers.has('content-encoding') ||
		!COMPRESSIBLE.test(type) ||
		length < MIN_BYTES
	)
		return response;
	const accepts = request.headers.get('accept-encoding') ?? '';
	const encoding = /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : null;
	const headers = new Headers(response.headers);
	headers.append('vary', 'Accept-Encoding');
	if (!encoding) return new Response(response.body, { status: response.status, headers });

	const compressor =
		encoding === 'br'
			? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
			: createGzip();
	headers.set('content-encoding', encoding);
	headers.delete('content-length');
	return new Response(
		response.body.pipeThrough(
			// Node's web streams are the same streams, typed separately from the DOM ones.
			Duplex.toWeb(compressor) as unknown as TransformStream<Uint8Array, Uint8Array>
		),
		{
			status: response.status,
			statusText: response.statusText,
			headers
		}
	);
}
