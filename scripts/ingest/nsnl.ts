/**
 * Enrich walks with ns.nl walk pages: photos, paved %, dogs policy.
 * Pages are matched to walks via their "Bekijk route" link to Wandelnet; theme pages
 * (e.g. "herfstwandelingen") have no such link and are skipped. Run after `wandelnet`.
 */
import { openDb, transaction } from '../../src/lib/server/db';
import { fetchCached, fetchList } from '../lib/http';
import { NSNL, parseWalkLinks, parseWalkPage } from '../lib/nsnl';

async function main() {
	const db = openDb();
	const slugs = parseWalkLinks(await fetchList(`${NSNL}/dagje-uit/wandelen`));
	console.log(`ns.nl lists ${slugs.length} walk/theme pages.`);

	const findWalk = db.prepare(`select id, name from walks where id = ?`);
	const update = db.prepare(`update walks set ns_url = ?, paved_pct = ?, dogs = ? where id = ?`);
	const deletePhotos = db.prepare(`delete from walk_photos where walk_id = ? and source = 'ns'`);
	const insertPhoto = db.prepare(
		`insert or ignore into walk_photos (walk_id, url, caption, source, sort) values (?, ?, ?, 'ns', ?)`
	);

	let matched = 0;
	const unmatched: string[] = [];
	for (const slug of slugs) {
		const url = `${NSNL}/dagje-uit/wandelen/${slug}`;
		const page = parseWalkPage(await fetchCached(url));
		if (!page.wandelnetId) continue; // theme page
		const walk = findWalk.get(`wandelnet:${page.wandelnetId}`) as
			{ id: string; name: string } | undefined;
		if (!walk) {
			unmatched.push(`${slug} → wandelnet ${page.wandelnetId}`);
			continue;
		}
		transaction(db, () => {
			update.run(url, page.pavedPct, page.dogs, walk.id);
			deletePhotos.run(walk.id);
			// ns.nl photos are the best ones; sort them before Wandelnet's (sort 0–1).
			page.photos.forEach((p, i) => insertPhoto.run(walk.id, p.url, p.caption, i - 10));
		});
		matched++;
		console.log(
			`✓ ${walk.name.padEnd(36)} verhard ${page.pavedPct ?? '?'}%  ${page.photos.length} foto's`
		);
	}

	console.log(`\nEnriched ${matched} walks.`);
	if (unmatched.length) console.log(`No Wandelnet walk for: ${unmatched.join(', ')}`);
	const missing = db.prepare(`select name from walks where ns_url is null`).all() as {
		name: string;
	}[];
	if (missing.length)
		console.log(`Walks without an ns.nl page: ${missing.map((m) => m.name).join(', ')}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
