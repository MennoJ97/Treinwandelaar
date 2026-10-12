import type { DatabaseSync } from 'node:sqlite';
import type { Station, TripLeg, TripOption } from '../types';

const GATEWAY = 'https://gateway.apiportal.ns.nl';

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
		return (data.trips ?? []).map(mapTrip);
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

export function mapTrip(t: any): TripOption {
	const legs: TripLeg[] = (t.legs ?? []).map((l: any): TripLeg => ({
		from: l.origin?.name ?? '?',
		to: l.destination?.name ?? '?',
		departure: normalizeTime(l.origin?.actualDateTime ?? l.origin?.plannedDateTime),
		plannedDeparture: normalizeTime(l.origin?.plannedDateTime),
		arrival: normalizeTime(l.destination?.actualDateTime ?? l.destination?.plannedDateTime),
		track: l.origin?.actualTrack ?? l.origin?.plannedTrack ?? null,
		product: l.product?.displayName ?? l.product?.shortCategoryName ?? l.name ?? 'Trein',
		direction: l.direction ?? null,
		cancelled: Boolean(l.cancelled)
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
