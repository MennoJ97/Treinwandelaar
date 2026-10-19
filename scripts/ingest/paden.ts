/**
 * Ingest streekpaden and LAW routes from Wandelnet as station-to-station day walks.
 *
 * Each path page lists numbered stages. We join the stages' GPX into one line, find where it passes
 * stations, and cut it into sections of roughly 8–26 km (see ../lib/sections.ts). A section borrows
 * descriptions, photos and review-weighted ratings from the stages it overlaps. The whole line is kept
 * too, with every station it passes, so the app can plan any other stretch of it (src/lib/path.ts).
 *
 * Expect the first run to take a while (~3 requests per stage at 1 req/s); later runs use the cache.
 * Personal use only: Wandelnet's terms forbid republishing this data.
 */
import { openDb } from '../../src/lib/server/db';
import type { Collection, Station } from '../../src/lib/types';
import { fetchCached, fetchList, oldestFetch } from '../lib/http';
import { chainStages, pickSections, plannerLine, sectionKm, stationHits } from '../lib/sections';
import { prunePaths, pruneStale, recordFetched, savePath, saveWalk } from '../lib/store';
import {
	WANDELNET,
	parseGpx,
	parseList,
	parsePathPage,
	parseReviews,
	parseRoutePage,
	stageNumber,
	type ListEntry,
	type RoutePage
} from '../lib/wandelnet';

const OVERVIEWS: { path: string; collection: Collection }[] = [
	{ path: '/streekpaden', collection: 'streekpad' },
	{ path: '/lange-afstand-wandelpaden', collection: 'law' }
];
const NOT_PATHS = new Set([
	'login',
	'meldpunt-wandelen',
	'privacyverklaring',
	'vrijwilliger-worden',
	'webwinkel',
	'word-donateur'
]);
/** How far a station may be from the path: this bit is walked extra, to/from the platform. */
const STATION_RANGE_M = 1500;

interface StageInfo {
	entry: ListEntry;
	number: number;
	page: RoutePage;
	rating: number | null;
	reviews: number;
}

function pathSlugs(html: string): string[] {
	const slugs = new Set<string>();
	for (const m of html.matchAll(/href='\/([a-z0-9-]+)'/g))
		if (!NOT_PATHS.has(m[1])) slugs.add(m[1]);
	return [...slugs];
}

async function loadStage(
	entry: ListEntry
): Promise<{ info: StageInfo; track: ReturnType<typeof parseGpx> }> {
	const page = parseRoutePage(await fetchCached(`${WANDELNET}/wandelroute/${entry.id}/`));
	const gpxUrl =
		page.gpxUrl ?? `https://wandelnet.api.routemaker.nl/content/gpx/wandelnet/${entry.id}.gpx`;
	const track = parseGpx(await fetchCached(gpxUrl));
	const reviews =
		page.reviewCount && page.reviewUrl
			? parseReviews(await fetchCached(page.reviewUrl))
			: { count: 0, average: null };
	return {
		info: {
			entry,
			number: stageNumber(entry)!,
			page,
			rating: reviews.average,
			reviews: reviews.count || page.reviewCount
		},
		track
	};
}

const twoDigits = (n: number) => String(n).padStart(2, '0');

async function main() {
	const db = openDb();
	const stations = db.prepare('select * from stations').all() as unknown as Station[];
	if (!stations.length) throw new Error('No stations; run `npm run ingest:stations` first.');
	const stationName = new Map(stations.map((s) => [s.code, s.name]));

	const seen = new Set<string>();
	const seenPaths = new Set<string>();
	const problems: string[] = [];

	for (const { path, collection } of OVERVIEWS) {
		const slugs = pathSlugs(await fetchList(`${WANDELNET}${path}`));
		console.log(`\n${path}: ${slugs.length} candidate pages`);

		for (const slug of slugs) {
			const pathUrl = `${WANDELNET}/${slug}`;
			let html: string;
			try {
				html = await fetchList(pathUrl);
			} catch (err) {
				problems.push(`${slug}: ${(err as Error).message}`);
				continue;
			}
			const stageEntries = parseList(html)
				.filter((e) => stageNumber(e) !== null)
				.sort((a, b) => stageNumber(a)! - stageNumber(b)!);
			if (stageEntries.length < 2) continue; // not a path page
			const { name: pathName, intro } = parsePathPage(html);

			const stages: { data: StageInfo; track: ReturnType<typeof parseGpx> }[] = [];
			for (const entry of stageEntries) {
				try {
					const { info, track } = await loadStage(entry);
					stages.push({ data: info, track });
				} catch (err) {
					problems.push(`${pathName} stage ${entry.name}: ${(err as Error).message}`);
				}
			}

			const chains = chainStages(stages);
			const planner = chains.map((chain, n) =>
				plannerLine(
					chain,
					stages.map(({ data: s }) => ({
						number: s.number,
						places:
							s.entry.startPlace && s.entry.endPlace
								? `${s.entry.startPlace} – ${s.entry.endPlace}`
								: null,
						url: `${WANDELNET}/wandelroute/${s.entry.id}/`
					})),
					stations,
					n
				)
			);
			if (planner.length) {
				savePath(db, {
					id: `pad:${slug}`,
					source: 'wandelnet',
					collection,
					name: pathName,
					lines: planner.map((p) => p.line),
					stops: planner.flatMap((p) => p.stops),
					stages: planner.flatMap((p) => p.stages),
					sourceUrl: pathUrl
				});
				seenPaths.add(`pad:${slug}`);
			}

			let made = 0;
			for (const chain of chains) {
				for (const [a, b] of pickSections(stationHits(chain.path, stations, STATION_RANGE_M))) {
					const track = chain.path.slice(a.index, b.index + 1);
					// Stages this section overlaps, weighted by how many points (≈ distance) it shares with each.
					const overlap = new Map<number, number>();
					for (let i = a.index; i <= b.index; i++)
						overlap.set(chain.stageOf[i], (overlap.get(chain.stageOf[i]) ?? 0) + 1);
					const used = [...overlap.keys()].map((s) => stages[s].data);
					const rated = [...overlap].filter(([s]) => stages[s].data.rating != null);
					const weight = rated.reduce((sum, [, n]) => sum + n, 0);
					const rating = weight
						? Math.round(
								(rated.reduce((sum, [s, n]) => sum + stages[s].data.rating! * n, 0) / weight) * 10
							) / 10
						: null;

					const from = stationName.get(a.code) ?? a.code;
					const to = stationName.get(b.code) ?? b.code;
					const id = `pad:${slug}:${a.code}-${b.code}`;
					const stageList = used
						.map((s) => `${twoDigits(s.number)} (${s.entry.startPlace} – ${s.entry.endPlace})`)
						.join(', ');
					saveWalk(db, {
						id,
						sourceId: `${slug}:${a.code}-${b.code}`,
						collection,
						name: `${pathName}: ${from} – ${to}`,
						startPlace: from,
						endPlace: to,
						startStation: a.code,
						endStation: b.code,
						startStationM: Math.round(a.metres),
						endStationM: Math.round(b.metres),
						isLoop: false,
						distanceKm: Math.round(sectionKm(a, b) * 10) / 10,
						statedDistanceKm: null,
						description: [
							intro,
							`Deze dagwandeling volgt ${used.length > 1 ? 'etappes' : 'etappe'} ${stageList} van het ${pathName}.`
						]
							.filter(Boolean)
							.join(' '),
						accessibility: null,
						features: [...new Set(used.flatMap((s) => s.page.features))].slice(0, 6),
						track,
						ratingAvg: rating,
						reviewCount: used.reduce((sum, s) => sum + s.reviews, 0),
						sourceUrl: `${WANDELNET}/wandelroute/${used[0].entry.id}/`,
						gpxUrl: null,
						photos: used
							.flatMap((s) => [s.page.headerImage, s.entry.image])
							.filter((u): u is string => !!u)
							.slice(0, 6)
							.map((url) => ({ url, caption: null }))
					});
					seen.add(id);
					made++;
				}
			}
			console.log(
				`✓ ${pathName.padEnd(32)} ${String(stages.length).padStart(2)} stages → ${made} day walks`
			);
		}
	}

	recordFetched(db, 'wandelnet-paden', oldestFetch());
	const pruned = pruneStale(
		db,
		OVERVIEWS.map((o) => o.collection),
		seen
	);
	const prunedPaths = prunePaths(db, 'wandelnet', seenPaths);
	console.log(
		`\nStored ${seen.size} day walks${pruned ? `, removed ${pruned} stale` : ''}; ` +
			`${seenPaths.size} paths to plan your own stretches on${prunedPaths ? `, removed ${prunedPaths}` : ''}.`
	);
	if (problems.length) {
		console.log(`\n${problems.length} issue(s):`);
		for (const p of problems) console.log(`  - ${p}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
