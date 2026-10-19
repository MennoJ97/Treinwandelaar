import { COLLECTION_LABELS, WALKABLE_STATION_M, type WalkListItem } from './types';

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

/**
 * The page title: "Brediusroute: rondje vanaf Naarden-Bussum, 10,4 km", "Oranje-Nassaupad etappe
 * 5: Rijen-Breda (Gilze-Rijen → Breda, 18,6 km)". A name that already says both stations
 * ("Waterliniepad: Heemskerk – Haarlem Spaarnwoude") just gets the distance.
 */
export function walkTitle(w: WalkListItem): string {
	const from = fromStation(w);
	const to = toStation(w);
	const km = `${formatKm(w.distanceKm)} km`;
	if (w.name.includes(from) && (w.isLoop || w.name.includes(to))) return `${w.name}, ${km}`;
	const route = w.isLoop ? `rondje vanaf ${from}` : `${from} → ${to}`;
	return w.name.includes(':') ? `${w.name} (${route}, ${km})` : `${w.name}: ${route}, ${km}`;
}

/** One or two sentences for search results and link previews. */
export function walkDescription(w: WalkListItem): string {
	const km = `${formatKm(w.distanceKm)} km`;
	const kind = COLLECTION_LABELS[w.collection];
	const bus = needsBus(w) ? ', met een stuk bus' : '';
	const what = w.isLoop
		? `Rondwandeling van ${km} vanaf station ${fromStation(w)}${bus}`
		: `Wandeling van station ${fromStation(w)} naar station ${toStation(w)}, ${km}${bus}`;
	return `${what}: ${w.name} (${kind}). Met de trein heen en terug, met reistijden vanaf jouw station.`;
}
