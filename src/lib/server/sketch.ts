import { simplify, type LngLat } from '../geo';

/**
 * A walk's line as an SVG path in a WIDTH-wide box, north up, for the outline on its own page.
 * Simplified to ~25 m: a few hundred points at most, a few kB of HTML.
 */
export function sketch(line: LngLat[], width = 600, pad = 12) {
	if (line.length < 2) return null;
	const points = simplify(line, 25);
	const kx = Math.cos((points[0][1] * Math.PI) / 180);
	const xs = points.map(([lng]) => lng * kx);
	const ys = points.map(([, lat]) => -lat);
	const [minX, maxX, minY, maxY] = [
		Math.min(...xs),
		Math.max(...xs),
		Math.min(...ys),
		Math.max(...ys)
	];
	const span = Math.max(maxX - minX, maxY - minY) || 1;
	const scale = (width - 2 * pad) / span;
	// Not taller than wide: a north-south walk gets a square box, centred.
	const height = Math.min(width, Math.round((maxY - minY) * scale + 2 * pad));
	const offX = (width - (maxX - minX) * scale) / 2;
	const offY = (height - (maxY - minY) * scale) / 2;
	const xy = points.map((_, i) => [
		Math.round((xs[i] - minX) * scale + offX),
		Math.round((ys[i] - minY) * scale + offY)
	]);
	return {
		width,
		height,
		d: xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(''),
		start: xy[0],
		end: xy.at(-1)!
	};
}
