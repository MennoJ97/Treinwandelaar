import { WALKABLE_STATION_M, type Cover, type WalkAlong, type WalkListItem } from './types';

const needsBusAt = (metres: number | null) => (metres ?? 0) > WALKABLE_STATION_M;

export const needsBus = (w: WalkListItem) =>
	needsBusAt(w.startStationM) || needsBusAt(w.endStationM);

/** Where the walk itself starts: the station, or the village when a bus is needed to get there. */
export const startLabel = (w: WalkListItem) =>
	(needsBusAt(w.startStationM) ? w.startPlace : w.startStationName) ?? w.startPlace ?? '?';

export const endLabel = (w: WalkListItem) =>
	(needsBusAt(w.endStationM) ? w.endPlace : w.endStationName) ?? w.endPlace ?? '?';

/** Where Wandelnet takes reports of problems on a route (blocked paths, missing signs…). */
export const WANDELNET_MELDPUNT = 'https://www.wandelnet.nl/meldpunt-wandelen';

/** "Routes © OpenStreetMap-bijdragers (ODbL), bijgewerkt 12-10-2026", for walks built from OSM. */
export function osmCredit(updated: string | null): string {
	const credit = 'Routes © OpenStreetMap-bijdragers (ODbL)';
	const [y, m, d] = updated?.split('-') ?? [];
	return d ? `${credit}, bijgewerkt ${d}-${m}-${y}` : credit;
}

/** Where to report a mistake in OSM's copy of a route, centred on its start. */
export const osmNoteUrl = ([lng, lat]: [number, number]) =>
	`https://www.openstreetmap.org/note/new#map=16/${lat}/${lng}`;

/** "Routedata © Stichting Wandelnet, bijgewerkt 12-10-2026", from the ingest's YYYY-MM-DD. */
export function wandelnetCredit(updated: string | null): string {
	const credit = 'Routedata © Stichting Wandelnet';
	const [y, m, d] = updated?.split('-') ?? [];
	return d ? `${credit}, bijgewerkt ${d}-${m}-${y}` : credit;
}

/** A comfortable day on a long-distance path, as the ingest cuts them (scripts/lib/sections.ts). */
export const DAY_WALK_KM = { min: 8, max: 26 };

/**
 * A walk's own page: '/route/osm:waterliniepad:HK-HLMS'. Ids are letters, digits, ':' and '-', so
 * this mostly leaves them as they are; ':' is fine in a path segment after the first.
 */
export const walkPath = (id: string) => `/route/${encodeURIComponent(id).replaceAll('%3A', ':')}`;

/** "18,6": distances as the rest of the app writes them. */
export const formatKm = (km: number) => km.toLocaleString('nl-NL', { maximumFractionDigits: 1 });

const fromStation = (w: WalkListItem) => w.startStationName ?? w.startPlace ?? '?';
const toStation = (w: WalkListItem) => w.endStationName ?? w.endPlace ?? '?';

/** Search engines cut titles at about this length, and descriptions at about 155. */
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 155;

/**
 * "WNW Veluwe - Buundekamp/Hoog-Wolfheze - blauwe route": a walk of a regional walking network
 * (wandelnetwerk), named for the network, its start (places, "Station X") and its waymark colour.
 */
export function wnwName(name: string): { region: string; places: string[]; colour: string } | null {
	// A dash with a space on at least one side: "Twente- Stokhorst", not the one in "Noord-Veluwe".
	const m = /^WNW\s+(.+?)(?:\s+-\s*|\s*-\s+)(.+?)(?:\s+-\s*|\s*-\s+)(\S+)\s+route$/i.exec(
		name.trim()
	);
	if (!m) return null;
	const places = m[2]
		.split('/')
		.map((p) => p.trim())
		.filter((p) => p && !/^station\b/i.test(p));
	return { region: m[1], places: [...new Set(places)], colour: m[3].toLowerCase() };
}

/**
 * What to call a walk of a walking network: "Ellecom gele route", or with the network's region when
 * the name gives no place but the station ("IJsseldelta groene route"). As many places as fit in
 * `max` characters, at least one.
 */
function wnwLabel(w: WalkListItem, max = Infinity): string | null {
	const wnw = wnwName(w.name);
	if (!wnw) return null;
	const stations = [w.startStationName, w.endStationName];
	const places = wnw.places.filter((p) => !stations.includes(p));
	if (!places.length) return `${wnw.region} ${wnw.colour} route`;
	let n = places.length;
	while (n > 1 && `${places.slice(0, n).join(', ')} ${wnw.colour} route`.length > max) n--;
	return `${places.slice(0, n).join(', ')} ${wnw.colour} route`;
}

/** The page's h1: the walk's name, tidied for a walking network's walk ("Ellecom gele route"). */
export const walkHeading = (w: WalkListItem) => (w.source === 'osm' && wnwLabel(w)) || w.name;

/**
 * The page title, about 60 characters at most where the name allows: "Rondje Dieren: Ellecom gele
 * route, 9 km", "Brediusroute: rondje Naarden-Bussum, 10,4 km", "Waterliniepad: Heemskerk –
 * Haarlem Spaarnwoude, 25 km". A name that is long already keeps only the distance after it.
 * Wandelnet's walks (seen only when signed in) keep their names as they are.
 */
export function walkTitle(w: WalkListItem): string {
	const from = fromStation(w);
	const to = toStation(w);
	const km = `${formatKm(w.distanceKm)} km`;
	if (w.source !== 'osm') {
		if (w.name.includes(from) && (w.isLoop || w.name.includes(to))) return `${w.name}, ${km}`;
		const route = w.isLoop ? `rondje vanaf ${from}` : `${from} → ${to}`;
		return w.name.includes(':') ? `${w.name} (${route}, ${km})` : `${w.name}: ${route}, ${km}`;
	}
	const fits = (t: string) => t.length <= TITLE_MAX;
	if (wnwName(w.name)) {
		const head = w.isLoop ? `Rondje ${from}: ` : '';
		const tail = w.isLoop ? `, ${km}` : `: ${from} → ${to}, ${km}`;
		const label = wnwLabel(w, TITLE_MAX - head.length - tail.length);
		const title = `${head}${label}${tail}`;
		return fits(title) || !w.isLoop ? title : `${head}${label}`;
	}
	// Past the length a search engine shows, the distance would be cut off anyway.
	const short = fits(`${w.name}, ${km}`) ? `${w.name}, ${km}` : w.name;
	if (w.name.includes(from) && (w.isLoop || w.name.includes(to))) return short;
	const full = w.isLoop
		? `${w.name}: rondje ${from}, ${km}`
		: w.name.includes(':')
			? `${w.name} (${from} → ${to}, ${km})`
			: `${w.name}: ${from} → ${to}, ${km}`;
	return fits(full) ? full : short;
}

const COVER_WORDS: Record<Cover, string> = {
	forest: 'bos',
	heath: 'heide',
	dunes: 'zand en duinen',
	builtUp: 'bebouwd gebied'
};

/** "bos en heide": the landscapes that make up at least a fifth of the walk, most first. */
export function landscape(along: WalkAlong | null | undefined, min = 20): string | null {
	const kinds = (Object.entries(along?.cover ?? {}) as [Cover, number][])
		.filter(([c, share]) => share >= min && c !== 'builtUp')
		.sort((a, b) => b[1] - a[1])
		.map(([c]) => COVER_WORDS[c]);
	return kinds.length ? listNl(kinds) : null;
}

/** "Rijen, Molenschot en Ulvenhout". */
export const listNl = (items: string[]) =>
	items.length > 1 ? `${items.slice(0, -1).join(', ')} en ${items.at(-1)}` : (items[0] ?? '');

/**
 * One sentence for search results and link previews, about 155 characters at most: where it starts
 * and ends, then what it passes, as much as fits.
 */
export function walkDescription(w: WalkListItem, along?: WalkAlong | null): string {
	const km = `${formatKm(w.distanceKm)} km`;
	const bus = needsBus(w) ? ' (met een stuk bus)' : '';
	const what = w.isLoop
		? `Rondwandeling van ${km} vanaf station ${fromStation(w)}${bus}`
		: `Wandeling van ${km} van station ${fromStation(w)} naar station ${toStation(w)}${bus}`;
	const land = landscape(along);
	const places = along?.places.filter((p) => p !== fromStation(w) && p !== toStation(w)) ?? [];
	const options: string[] = [];
	for (let n = Math.min(places.length, 4); n >= 1; n--) {
		const past = `, langs ${listNl(places.slice(0, n))}`;
		if (land) options.push(`${what}${past}, door ${land}.`);
		options.push(`${what}${past}.`);
	}
	if (land) options.push(`${what}, door ${land}.`);
	options.push(`${what}: ${walkHeading(w)}. Met de trein heen en terug.`, `${what}.`);
	return options.find((d) => d.length <= DESCRIPTION_MAX) ?? `${what}.`;
}

/** "Wandelnetwerk Veluwe" for a walk of a walking network; null for any other. */
export const walkNetwork = (w: WalkListItem) => {
	const wnw = w.source === 'osm' ? wnwName(w.name) : null;
	return wnw ? `Wandelnetwerk ${wnw.region}` : null;
};

/**
 * What the walk passes, in a few plain sentences from OSM's data: places, nature areas, landscape,
 * surface and sights. Empty without that data.
 */
export function alongSentences(w: WalkListItem, along: WalkAlong | null | undefined): string[] {
	if (!along) return [];
	const out: string[] = [];
	const stations = [w.startStationName, w.endStationName];
	const places = along.places.filter((p) => !stations.includes(p));
	if (places.length) out.push(`Onderweg kom je langs ${listNl(places)}.`);
	if (along.nature.length) out.push(`De route gaat door ${listNl(along.nature)}.`);
	const cover = (Object.entries(along.cover) as [Cover, number][]).sort((a, b) => b[1] - a[1]);
	if (cover.length)
		out.push(
			`Ongeveer ${listNl(cover.map(([c, share], i) => `${share}%${i ? '' : ' van de route'} ${i ? 'door ' : 'loopt door '}${COVER_WORDS[c]}`))}.`
		);
	const { paved, unpaved } = along.surface;
	if (paved + unpaved >= 50)
		out.push(
			`Volgens OpenStreetMap is ongeveer ${paved}% van de route verhard en ${unpaved}% onverhard` +
				(paved + unpaved < 100 ? '; van de rest is het niet bekend.' : '.')
		);
	if (along.sights.length) out.push(`Bezienswaardig onderweg: ${listNl(along.sights)}.`);
	return out;
}
