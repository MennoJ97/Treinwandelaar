import { COLLECTION_LABELS, type WalkDetail } from '../types';
import { endLabel, startLabel } from '../walk';

const ODBL = 'https://opendatacommons.org/licenses/odbl/1-0/';
const WANDELNET_TERMS = 'https://www.wandelnet.nl/algemene-voorwaarden';

const escape = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Who to credit, in the file itself: GPX files travel on to apps and other people, away from the
 * site's credit line. OSM data is ODbL, which asks for the attribution and licence with the data; LAW
 * routes and streekpaden in OSM also name Wandelnet, as Wandelnet asked when allowing them in OSM.
 * Wandelnet's own data comes with its terms: own use only.
 */
function credit(walk: WalkDetail): { author: string; license: string; note: string } {
	if (walk.source === 'osm') {
		const route =
			walk.collection === 'law' || walk.collection === 'streekpad'
				? 'Route van Stichting Wandelnet, ingetekend door OpenStreetMap-bijdragers.'
				: 'Route ingetekend door OpenStreetMap-bijdragers.';
		return {
			author: 'OpenStreetMap-bijdragers',
			license: ODBL,
			note: `${route} © OpenStreetMap-bijdragers, ODbL (openstreetmap.org/copyright).`
		};
	}
	return {
		author: 'Stichting Wandelnet',
		license: WANDELNET_TERMS,
		note: 'Routedata © Stichting Wandelnet. Alleen voor eigen gebruik.'
	};
}

/** "Tiel – Buren, 14,2 km (Streekpad)": what the file is, for apps that only show the name. */
function summary(walk: WalkDetail): string {
	const km = walk.distanceKm.toFixed(1).replace('.', ',');
	const route = walk.isLoop
		? `Rondwandeling vanaf ${startLabel(walk)}`
		: `${startLabel(walk)} – ${endLabel(walk)}`;
	return `${route}, ${km} km (${COLLECTION_LABELS[walk.collection]})`;
}

/**
 * A walk's route as GPX 1.1, one track. The line is the simplified one the map draws (within ~8 m of
 * the source), which is plenty to follow on a phone; it has no heights or times.
 */
export function walkGpx(walk: WalkDetail): string {
	const { author, license, note } = credit(walk);
	const desc = [summary(walk), walk.description, note].filter(Boolean).join('\n\n');
	const points = walk.geometry
		.map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"/>`)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Treinwandelaar" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escape(walk.name)}</name>
    <desc>${escape(desc)}</desc>
    <author><name>${escape(author)}</name></author>
    <copyright author="${escape(author)}"><license>${license}</license></copyright>
    <link href="${escape(walk.sourceUrl)}"><text>Bron</text></link>
  </metadata>
  <trk>
    <name>${escape(walk.name)}</name>
    <desc>${escape(summary(walk))}</desc>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

/** "Langs de Proefdijk" → "langs-de-proefdijk.gpx": ASCII, so any browser keeps the name. */
export function gpxFilename(walk: WalkDetail): string {
	const slug = walk.name
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return `${slug || 'wandeling'}.gpx`;
}
