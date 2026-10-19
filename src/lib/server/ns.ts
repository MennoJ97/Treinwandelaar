import type { DatabaseSync } from 'node:sqlite';
import type { LngLat } from '../geo';
import type { Station, TripLeg, TripOption } from '../types';
import { buildRailNetwork, legLine, type RailNetwork } from './railMap';

const GATEWAY = 'https://gateway.apiportal.ns.nl';

/** Tracks seldom change: the network is fetched weekly, and built once a day per process. */
const RAIL_TTL_SECONDS = 7 * 24 * 3600;
let rail: { builtAt: number; network: RailNetwork } | null = null;

export class NsApiError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

/* eslint-disable @typescript-eslint/no-explicit-any -- NS responses are loosely typed; mapped defensively below */

export class NsClient {
	constructor(
		private readonly apiKey: string,
		private readonly db?: DatabaseSync
	) {
		if (!apiKey) throw new NsApiError('NS_API_KEY is not set (see .env.example)', 500);
	}

	private async get(path: string, params: Record<string, string>): Promise<any> {
		const url = new URL(path, GATEWAY);
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
		const res = await fetch(url, {
			headers: { 'Ocp-Apim-Subscription-Key': this.apiKey, Accept: 'application/json' }
		});
		if (!res.ok) {
			const body = await res.text();
			throw new NsApiError(
				`NS API ${res.status} for ${url.pathname}: ${body.slice(0, 300)}`,
				res.status
			);
		}
		return res.json();
	}

	/** GET with a SQLite-backed cache; `ttlSeconds` is how long a stored response stays valid. */
	private async cachedGet(path: string, params: Record<string, string>, ttlSeconds: number) {
		if (!this.db) return this.get(path, params);
		const key = `${path}?${new URLSearchParams(params)}`;
		const now = Math.floor(Date.now() / 1000);
		const hit = this.db
			.prepare('select json, fetched_at from trip_cache where key = ?')
			.get(key) as { json: string; fetched_at: number } | undefined;
		if (hit && now - hit.fetched_at < ttlSeconds) return JSON.parse(hit.json);
		const data = await this.get(path, params);
		this.db
			.prepare('insert or replace into trip_cache (key, json, fetched_at) values (?, ?, ?)')
			.run(key, JSON.stringify(data), now);
		return data;
	}

	async stations(): Promise<Station[]> {
		const data = await this.get('/nsapp-stations/v2', { countryCodes: 'NL', limit: '1000' });
		return (data.payload ?? []).map(mapStation).filter((s: Station | null): s is Station => !!s);
	}

	/** All current disruptions and announced engineering works. Cached for 10 minutes. */
	async disruptions(): Promise<unknown[]> {
		const data = await this.cachedGet('/reisinformatie-api/api/v3/disruptions', {}, 600);
		return Array.isArray(data) ? data : (data.payload ?? []);
	}

	async trips(opts: {
		from: string;
		to: string;
		dateTime: string;
		searchForArrival?: boolean;
		ttlSeconds?: number;
	}): Promise<TripOption[]> {
		const data = await this.cachedGet(
			'/reisinformatie-api/api/v3/trips',
			{
				fromStation: opts.from,
				toStation: opts.to,
				dateTime: opts.dateTime,
				searchForArrival: String(opts.searchForArrival ?? false)
			},
			opts.ttlSeconds ?? 300
		);
		const network = await this.railNetwork().catch(() => null);
		const codes = this.stationCodes();
		return (data.trips ?? []).map((t: any) => mapTrip(t, network && { network, codes }));
	}

	/** The rail network to draw trains along their tracks; null when it can't be had. */
	async railNetwork(): Promise<RailNetwork | null> {
		if (rail && Date.now() - rail.builtAt < 24 * 3600_000) return rail.network;
		const data = await this.cachedGet('/Spoorkaart-API/api/v1/spoorkaart', {}, RAIL_TTL_SECONDS);
		const network = buildRailNetwork(data.payload?.features ?? []);
		if (!network.size) return null;
		rail = { builtAt: Date.now(), network };
		return network;
	}

	/** UIC code → NS station code: trip stops carry the one, the network the other. */
	private stationCodes(): Map<string, string> {
		const rows = (this.db?.prepare('select uic, code from stations where uic is not null').all() ??
			[]) as { uic: string; code: string }[];
		return new Map(rows.map((r) => [r.uic, r.code]));
	}
}

export function mapStation(s: any): Station | null {
	const code = s.id?.code ?? s.code;
	const lat = s.location?.lat ?? s.lat;
	const lng = s.location?.lng ?? s.lng;
	if (!code || lat == null || lng == null) return null;
	return {
		code: String(code).toUpperCase(),
		uic: String(s.id?.uicCode ?? s.UICCode ?? s.uicCode ?? '') || null,
		name: s.names?.long ?? s.namen?.lang ?? s.name ?? code,
		lat: Number(lat),
		lng: Number(lng)
	};
}

/** NS returns "2026-10-17T09:12:00+0200"; make it RFC3339 ("+02:00") so every parser agrees. */
export function normalizeTime(value: string | undefined): string {
	return (value ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
}

/**
 * A trip as the page shows it. With the rail network, each train leg's line follows the tracks
 * between its stops; without it (or for a bus) the line goes straight from stop to stop.
 */
export function mapTrip(
	t: any,
	rail?: { network: RailNetwork; codes: Map<string, string> } | null
): TripOption {
	const line = (l: any): LngLat[] => {
		const stops = (l.stops ?? [])
			.filter((s: any) => s?.lat != null && s?.lng != null)
			.map((s: any) => ({
				code: rail?.codes.get(String(s.uicCode)) ?? null,
				at: [Number(s.lng), Number(s.lat)] as LngLat
			}));
		return legLine(l.product?.type === 'BUS' ? null : (rail?.network ?? null), stops);
	};
	const legs: TripLeg[] = (t.legs ?? []).map((l: any): TripLeg => ({
		from: l.origin?.name ?? '?',
		to: l.destination?.name ?? '?',
		departure: normalizeTime(l.origin?.actualDateTime ?? l.origin?.plannedDateTime),
		plannedDeparture: normalizeTime(l.origin?.plannedDateTime),
		arrival: normalizeTime(l.destination?.actualDateTime ?? l.destination?.plannedDateTime),
		track: l.origin?.actualTrack ?? l.origin?.plannedTrack ?? null,
		product: l.product?.displayName ?? l.product?.shortCategoryName ?? l.name ?? 'Trein',
		category: String(
			l.product?.shortCategoryName ??
				l.product?.categoryCode ??
				(l.product?.type === 'BUS' ? 'BUS' : 'TR')
		).toUpperCase(),
		isBus: l.product?.type === 'BUS',
		direction: l.direction ?? null,
		cancelled: Boolean(l.cancelled),
		line: line(l)
	}));
	return {
		departure: legs[0]?.departure,
		arrival: legs.at(-1)?.arrival ?? legs[0]?.arrival,
		plannedDurationMin: t.plannedDurationInMinutes,
		actualDurationMin: t.actualDurationInMinutes ?? null,
		transfers: t.transfers ?? Math.max(0, legs.length - 1),
		status: t.status ?? 'NORMAL',
		crowdForecast: t.crowdForecast ?? null,
		shareUrl: t.shareUrl?.uri ?? (typeof t.shareUrl === 'string' ? t.shareUrl : null),
		legs
	};
}
