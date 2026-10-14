import { db } from '#lib/server/context.js';
import type { RequestHandler } from './$types';

/**
 * The walks built from OpenStreetMap, as GeoJSON: the ODbL asks whoever publicly uses a database
 * derived from OSM to offer that database too. Public, like the demo.
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
	const collection = {
		type: 'FeatureCollection',
		license: 'ODbL-1.0',
		attribution: '© OpenStreetMap contributors, https://www.openstreetmap.org/copyright',
		features: rows.map((r) => ({
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
		}))
	};
	return new Response(JSON.stringify(collection), {
		headers: {
			'content-type': 'application/geo+json',
			'content-disposition': 'attachment; filename="treinwandelaar-osm.geojson"'
		}
	});
};
