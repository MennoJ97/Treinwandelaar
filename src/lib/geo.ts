export type LngLat = [lng: number, lat: number];

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: LngLat, b: LngLat): number {
	const dLat = toRad(b[1] - a[1]);
	const dLng = toRad(b[0] - a[0]);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function lineLengthKm(points: LngLat[]): number {
	let m = 0;
	for (let i = 1; i < points.length; i++) m += haversine(points[i - 1], points[i]);
	return m / 1000;
}

export interface HasLocation {
	lat: number;
	lng: number;
}

/** Nearest item within `maxMetres`, or null. Linear scan: ~400 NL stations is trivially fast. */
export function nearest<T extends HasLocation>(
	point: LngLat,
	items: T[],
	maxMetres: number
): { item: T; metres: number } | null {
	let best: { item: T; metres: number } | null = null;
	for (const item of items) {
		const metres = haversine(point, [item.lng, item.lat]);
		if (metres <= maxMetres && (!best || metres < best.metres)) best = { item, metres };
	}
	return best;
}

/**
 * Douglas–Peucker simplification. Works in a local equirectangular projection (metres),
 * which is accurate enough at walk scale and keeps the tolerance meaningful.
 */
export function simplify(points: LngLat[], toleranceM: number): LngLat[] {
	if (points.length <= 2) return points;
	const lat0 = toRad(points[0][1]);
	const xy = points.map(([lng, lat]) => [
		toRad(lng) * Math.cos(lat0) * EARTH_RADIUS_M,
		toRad(lat) * EARTH_RADIUS_M
	]);
	const keep = new Uint8Array(points.length);
	keep[0] = keep[points.length - 1] = 1;
	const stack: [number, number][] = [[0, points.length - 1]];
	while (stack.length) {
		const [start, end] = stack.pop()!;
		let maxDist = 0;
		let index = -1;
		for (let i = start + 1; i < end; i++) {
			const d = segmentDistance(xy[i], xy[start], xy[end]);
			if (d > maxDist) {
				maxDist = d;
				index = i;
			}
		}
		if (index !== -1 && maxDist > toleranceM) {
			keep[index] = 1;
			stack.push([start, index], [index, end]);
		}
	}
	return points.filter((_, i) => keep[i]);
}

function segmentDistance(p: number[], a: number[], b: number[]): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const lenSq = dx * dx + dy * dy;
	const t =
		lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
	return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
