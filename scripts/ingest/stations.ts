/**
 * Load Dutch railway stations into the `stations` table.
 * Uses the NS API when NS_API_KEY is set, otherwise OpenStreetMap via Overpass
 * (NL stations carry the NS code in `railway:ref`, e.g. UT for Utrecht Centraal).
 */
import { openDb, transaction } from '../../src/lib/server/db';
import { NsClient } from '../../src/lib/server/ns';
import type { Station } from '../../src/lib/types';
import { queryOverpass } from '../lib/overpass';

const OVERPASS_QUERY = `
[out:json][timeout:90];
nwr["railway"="station"]["railway:ref"](50.7,3.3,53.6,7.3);
out center tags;
`;

async function fromOverpass(): Promise<Station[]> {
	const text = await queryOverpass(OVERPASS_QUERY);
	const { elements } = JSON.parse(text) as {
		elements: {
			lat?: number;
			lon?: number;
			center?: { lat: number; lon: number };
			tags: Record<string, string>;
		}[];
	};
	const byCode = new Map<string, Station>();
	for (const el of elements) {
		const lat = el.lat ?? el.center?.lat;
		const lng = el.lon ?? el.center?.lon;
		const code = el.tags['railway:ref']?.toUpperCase();
		// The bbox includes Belgian/German stations, whose railway:ref is a different code system.
		// Dutch ones: UIC code with country prefix 84 when tagged, otherwise NS-style mixed-case
		// refs ("Cl", "Bsd", "Gdm") versus all-caps DS100 codes in Germany.
		const uic = el.tags.uic_ref;
		const rawRef = el.tags['railway:ref'];
		const isDutch = uic ? uic.startsWith('84') : /^[A-Z][a-z]{1,4}$/.test(rawRef);
		if (!code || lat == null || lng == null || !isDutch) continue;
		if (el.tags.station === 'subway' || el.tags.usage === 'tourism' || byCode.has(code)) continue;
		byCode.set(code, {
			code,
			uic: el.tags.uic_ref ?? null,
			name: el.tags.name ?? code,
			lat,
			lng
		});
	}
	return [...byCode.values()];
}

async function main() {
	const key = process.env.NS_API_KEY;
	const stations = key ? await new NsClient(key).stations() : await fromOverpass();
	console.log(`Source: ${key ? 'NS API' : 'OpenStreetMap (no NS_API_KEY set)'}`);

	const db = openDb();
	const upsert = db.prepare(
		`insert into stations (code, uic, name, lat, lng) values (?, ?, ?, ?, ?)
		 on conflict(code) do update set uic = excluded.uic, name = excluded.name, lat = excluded.lat, lng = excluded.lng`
	);
	transaction(db, () => {
		for (const s of stations) upsert.run(s.code, s.uic, s.name, s.lat, s.lng);
	});
	console.log(`Stored ${stations.length} stations.`);
	const ut = db.prepare("select * from stations where code = 'UT'").get();
	console.log('Utrecht Centraal:', ut ?? 'MISSING');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
