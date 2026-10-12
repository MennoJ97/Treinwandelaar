import { parse, type HTMLElement } from 'node-html-parser';
import type { LngLat } from '../../src/lib/geo';

export const WANDELNET = 'https://www.wandelnet.nl';

export interface ListEntry {
	id: string;
	name: string;
	startPlace: string | null;
	endPlace: string | null;
	statedKm: number | null;
	image: string | null;
}

export interface RoutePage {
	name: string;
	startPlace: string | null;
	endPlace: string | null;
	statedKm: number | null;
	type: string | null;
	features: string[];
	description: string | null;
	accessibility: string | null;
	start: LngLat | null;
	end: LngLat | null;
	reviewCount: number;
	reviewUrl: string | null;
	gpxUrl: string | null;
	headerImage: string | null;
}

const text = (el: HTMLElement | null | undefined) => el?.text.replace(/\s+/g, ' ').trim() || null;

const absolute = (href: string) => new URL(href, WANDELNET).toString();

/** "14,5 km" / "14.5 KM" → 14.5 */
export function parseKm(value: string | null | undefined): number | null {
	const m = value?.match(/(\d+(?:[.,]\d+)?)\s*km/i);
	return m ? Number(m[1].replace(',', '.')) : null;
}

/** "Culemborg - Beesd" → ["Culemborg", "Beesd"]. Place names may contain hyphens without spaces. */
export function splitPlaces(value: string | null): [string | null, string | null] {
	if (!value) return [null, null];
	const parts = value.split(/\s+[-–]\s+/);
	return parts.length === 2 ? [parts[0].trim(), parts[1].trim()] : [value.trim(), null];
}

/** The "Alle NS-wandelroutes" overview: one card per route. */
export function parseList(html: string): ListEntry[] {
	const root = parse(html);
	const entries = new Map<string, ListEntry>();
	for (const card of root.querySelectorAll('article.at-threeColumns__column')) {
		const href = card.querySelector('a.at-threeColumns__linkOverlay')?.getAttribute('href') ?? '';
		const id = href.match(/\/wandelroute\/(\d+)/)?.[1];
		if (!id || entries.has(id)) continue;
		const [name, places] = (text(card.querySelector('.at-threeColumns__title')) ?? '').split(' | ');
		const [startPlace, endPlace] = splitPlaces(places ?? null);
		const img = card.querySelector('img.at-threeColumns__image')?.getAttribute('src');
		entries.set(id, {
			id,
			name: name.trim(),
			startPlace,
			endPlace,
			statedKm: parseKm(text(card.querySelector('.at-threeColumns__text'))),
			image: img ? absolute(img.replace(/width=\d+&height=\d+/, 'width=800&height=400')) : null
		});
	}
	return [...entries.values()];
}

function mapsPoint(href: string | undefined): LngLat | null {
	const m = href?.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
	return m ? [Number(m[2]), Number(m[1])] : null;
}

export function parseRoutePage(html: string): RoutePage {
	const root = parse(html);

	const props = new Map<string, string>();
	for (const p of root.querySelectorAll('.routeInformation__info')) {
		const title = text(p.querySelector('.routeInformation__title'))?.replace(/:$/, '');
		const value = text(p)?.replace(/^[^:]+:\s*/, '');
		if (title && value) props.set(title, value);
	}

	const subtitle = text(root.querySelector('h2.routeSubTitle'));
	const [startPlace, endPlace] = splitPlaces(subtitle?.replace(/\s*\([^)]*\)\s*$/, '') ?? null);

	let start: LngLat | null = null;
	let end: LngLat | null = null;
	for (const c of root.querySelectorAll('.poiStartEndLocation__container')) {
		const point = mapsPoint(c.querySelector('a')?.getAttribute('href'));
		const title = text(c.querySelector('.poiStartEndLocation__title'));
		if (title === 'Startpunt') start = point;
		if (title === 'Eindpunt') end = point;
	}

	const reviewLink = root
		.querySelectorAll('a.tabRouteDetail__link')
		.find((a) => /Reviews/i.test(a.text));
	const header =
		html.match(/https:\/\/[^"')]+\/content\/img\/\d+\/img-C1000x550\.jpg/)?.[0] ?? null;

	return {
		name: text(root.querySelector('h1.routeTitle')) ?? '',
		startPlace,
		endPlace,
		statedKm: parseKm(props.get('Lengte') ?? subtitle),
		type: props.get('Type') ?? null,
		features: (props.get('Kenmerken') ?? '')
			.split(',')
			.map((f) => f.trim())
			.filter(Boolean),
		description: text(root.querySelector('.routeInformation__introductionText')),
		accessibility: text(root.querySelector('p.routeAccessibility')),
		start,
		end,
		reviewCount: Number(reviewLink?.text.match(/\((\d+)\)/)?.[1] ?? 0),
		reviewUrl: reviewLink ? absolute(reviewLink.getAttribute('href')!) : null,
		gpxUrl: root.querySelector('a.routeAction__link--gpx')?.getAttribute('href') ?? null,
		headerImage: header
	};
}

/** Star ratings from the review tab ("4 van de 5 sterren"), averaged. */
export function parseReviews(html: string): { count: number; average: number | null } {
	const scores = [...html.matchAll(/(\d) van de 5 sterren/g)].map((m) => Number(m[1]));
	if (!scores.length) return { count: 0, average: null };
	const average = scores.reduce((a, b) => a + b, 0) / scores.length;
	return { count: scores.length, average: Math.round(average * 10) / 10 };
}

/** Track (or route) points from a GPX file, as [lng, lat]. */
export function parseGpx(xml: string): LngLat[] {
	const points: LngLat[] = [];
	const tag = /<trkpt\b[^>]*>/.test(xml) ? 'trkpt' : 'rtept';
	for (const m of xml.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))) {
		const lat = m[1].match(/lat="([^"]+)"/)?.[1];
		const lon = m[1].match(/lon="([^"]+)"/)?.[1];
		if (lat && lon) points.push([Number(lon), Number(lat)]);
	}
	return points;
}
