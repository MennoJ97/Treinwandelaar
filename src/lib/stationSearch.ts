import type { Station } from './types';

/** Lowercase, no accents, no "'s-" prefix, punctuation as spaces: "'s-Hertogenbosch" → "hertogenbosch". */
export function normalize(text: string): string {
	return text
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/(^|\s)'s-/g, '$1')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/**
 * Other names a station goes by, as normalized text. Matching runs against all of them, so every
 * prefix of the everyday name works too ("den bo" finds 's-Hertogenbosch).
 */
const ALSO_KNOWN_AS: [RegExp, string][] = [
	[/^hertogenbosch\b/, 'den bosch'],
	[/^den haag\b/, 'the hague'],
	[/\bcentraal\b/, 'cs']
];

function variants(name: string): string[] {
	const base = normalize(name);
	const names = [base];
	for (const [pattern, alias] of ALSO_KNOWN_AS)
		if (pattern.test(base)) names.push(base.replace(pattern, alias));
	return names;
}

/**
 * Stations matching what's typed, best first: an exact NS code ("UT"), then names starting with
 * the query, then names where every typed word starts a word ("haag cen" → Den Haag Centraal),
 * then names merely containing it. Within a rank, Centraal stations first, then alphabetical.
 */
export function searchStations(stations: Station[], query: string, limit = 8): Station[] {
	const q = normalize(query);
	if (!q) return [];
	const code = query.trim().toUpperCase();
	const words = q.split(' ');

	const ranked: { station: Station; rank: number }[] = [];
	for (const station of stations) {
		let rank = station.code === code ? 0 : Infinity;
		for (const name of variants(station.name)) {
			const nameWords = name.split(' ');
			if (name.startsWith(q)) rank = Math.min(rank, 1);
			else if (words.every((w) => nameWords.some((nw) => nw.startsWith(w))))
				rank = Math.min(rank, 2);
			else if (name.includes(q)) rank = Math.min(rank, 3);
		}
		if (rank !== Infinity) ranked.push({ station, rank });
	}

	const centraal = (s: Station) => (/centraal/i.test(s.name) ? 0 : 1);
	return ranked
		.sort(
			(a, b) =>
				a.rank - b.rank ||
				centraal(a.station) - centraal(b.station) ||
				a.station.name.localeCompare(b.station.name, 'nl')
		)
		.slice(0, limit)
		.map((r) => r.station);
}
