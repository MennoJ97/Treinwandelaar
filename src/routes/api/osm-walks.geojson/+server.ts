import { db } from '#lib/server/context.js';
import type { RequestHandler } from './$types';

/**
 * The walks built from OpenStreetMap, as GeoJSON: the ODbL asks whoever publicly uses a database
 * derived from OSM to offer that database too. Public, like the demo. The whole LAW routes and
 * streekpaden that stretches are planned on come along, with the stations they pass.
 */
export const GET: RequestHandler = () => {
	const rows = db()
		.prepare(
			`select id, name, collection, start_station, end_station, is_loop, distance_km, source_url,
				geometry from walks where source = 'osm' order by name`
		)
		.all() as {
		id: string;
		name: string;
		collection: string;
		start_station: string | null;
		end_station: string | null;
		is_loop: number;
		distance_km: number;
		source_url: string;
		geometry: string;
	}[];
	const paths = db()
		.prepare(
			`select id, name, collection, km, stops, source_url, lines from paths
			 where source = 'osm' order by name`
		)
		.all() as {
		id: string;
		name: string;
		collection: string;
		km: number;
		stops: string;
		source_url: string;
		lines: string;
	}[];
	const collection = {
		type: 'FeatureCollection',
		license: 'ODbL-1.0',
		attribution: '© OpenStreetMap contributors, https://www.openstreetmap.org/copyright',
		features: [
			...rows.map((r) => ({
				type: 'Feature',
				id: r.id,
				properties: {
					name: r.name,
					kind: r.collection,
					startStation: r.start_station,
					endStation: r.end_station,
					loop: !!r.is_loop,
					distanceKm: r.distance_km,
					osm: r.source_url
				},
				geometry: { type: 'LineString', coordinates: JSON.parse(r.geometry) }
			})),
			...paths.map((p) => ({
				type: 'Feature',
				id: p.id,
				properties: {
					name: p.name,
					kind: `${p.collection}-route`,
					distanceKm: p.km,
					stations: (JSON.parse(p.stops) as { code: string; km: number }[]).map(({ code, km }) => ({
						code,
						km
					})),
					osm: p.source_url
				},
				geometry: { type: 'MultiLineString', coordinates: JSON.parse(p.lines) }
			}))
		]
	};
	return new Response(JSON.stringify(collection), {
		headers: {
			'content-type': 'application/geo+json',
			'content-disposition': 'attachment; filename="treinwandelaar-osm.geojson"'
		}
	});
};
