/**
 * The Dutch rail network as NS draws it (Spoorkaart API): a track line between every two adjacent
 * stations. A trip leg only names the stations it stops at, and an intercity skips most of them, so
 * between two stops we take the shortest way over the tracks to draw where the train actually runs.
 */
import { haversine, lineLengthKm, simplify, type LngLat } from '../geo';

interface Edge {
	to: string;
	km: number;
	/** Track line from this station to `to`. */
	line: LngLat[];
}

/** Station code (upper case) → the tracks leaving it, both ways. */
export type RailNetwork = Map<string, Edge[]>;

/* eslint-disable @typescript-eslint/no-explicit-any -- the Spoorkaart GeoJSON is mapped defensively */

export function buildRailNetwork(features: any[]): RailNetwork {
	const network: RailNetwork = new Map();
	const add = (from: string, edge: Edge) => {
		const list = network.get(from);
		if (list) list.push(edge);
		else network.set(from, [edge]);
	};
	for (const f of features) {
		const from = String(f?.properties?.from ?? '').toUpperCase();
		const to = String(f?.properties?.to ?? '').toUpperCase();
		const line = f?.geometry?.type === 'LineString' ? (f.geometry.coordinates as LngLat[]) : [];
		if (!from || !to || line.length < 2) continue;
		const km = lineLengthKm(line);
		add(from, { to, km, line });
		add(to, { to: from, km, line: [...line].reverse() });
	}
	return network;
}

/** Shortest track line between two stations, or null when the network doesn't join them. */
function shortest(network: RailNetwork, from: string, to: string): LngLat[] | null {
	if (from === to || !network.has(from) || !network.has(to)) return null;
	// Plain Dijkstra with a linear scan for the next node: a few hundred stations, so that's fine.
	const dist = new Map<string, number>([[from, 0]]);
	const prev = new Map<string, { node: string; edge: Edge }>();
	const done = new Set<string>();
	for (;;) {
		let node: string | null = null;
		let best = Infinity;
		for (const [n, d] of dist) if (!done.has(n) && d < best) [node, best] = [n, d];
		if (node === null) return null;
		if (node === to) break;
		done.add(node);
		for (const edge of network.get(node) ?? []) {
			const d = best + edge.km;
			if (d < (dist.get(edge.to) ?? Infinity)) {
				dist.set(edge.to, d);
				prev.set(edge.to, { node, edge });
			}
		}
	}
	const edges: Edge[] = [];
	for (let n = to; n !== from; n = prev.get(n)!.node) edges.unshift(prev.get(n)!.edge);
	return edges.flatMap((e, i) => (i ? e.line.slice(1) : e.line));
}

/** Detail that still reads at walk zoom, without sending every bend of the track. */
const TOLERANCE_M = 25;

/**
 * The line a leg follows: over the tracks between consecutive stops where the network knows the
 * way, straight from stop to stop where it doesn't (a bus, a station abroad, a missing piece).
 */
export function legLine(
	network: RailNetwork | null,
	stops: { code: string | null; at: LngLat }[]
): LngLat[] {
	const line: LngLat[] = [];
	for (let i = 0; i < stops.length; i++) {
		const a = stops[i - 1];
		const b = stops[i];
		const track = a?.code && b.code && network ? shortest(network, a.code, b.code) : null;
		// A detour far longer than the straight line means the network took a wrong turn somewhere.
		const plausible = track && lineLengthKm(track) * 1000 < 2.5 * haversine(a.at, b.at) + 2000;
		if (plausible) line.push(...(line.length ? track.slice(1) : track));
		else line.push(b.at);
	}
	return simplify(line, TOLERANCE_M).map(([lng, lat]) => [round(lng), round(lat)]);
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;
