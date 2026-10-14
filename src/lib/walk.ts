import { WALKABLE_STATION_M, type WalkSummary } from './types';

const needsBusAt = (metres: number | null) => (metres ?? 0) > WALKABLE_STATION_M;

export const needsBus = (w: WalkSummary) =>
	needsBusAt(w.startStationM) || needsBusAt(w.endStationM);

/** Where the walk itself starts: the station, or the village when a bus is needed to get there. */
export const startLabel = (w: WalkSummary) =>
	(needsBusAt(w.startStationM) ? w.startPlace : w.startStationName) ?? w.startPlace ?? '?';

export const endLabel = (w: WalkSummary) =>
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
