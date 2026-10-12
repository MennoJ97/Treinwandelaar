import { parse } from 'node-html-parser';

export const NSNL = 'https://www.ns.nl';

export interface NsWalkPage {
	wandelnetId: string | null;
	fromStation: string | null;
	toStation: string | null;
	pavedPct: number | null;
	dogs: string | null;
	goodToKnow: string | null;
	photos: { url: string; caption: string | null }[];
}

/** Slugs of individual walks linked from the overview (also includes theme pages, filtered later). */
export function parseWalkLinks(html: string): string[] {
	const slugs = new Set<string>();
	for (const m of html.matchAll(/\/dagje-uit\/wandelen\/([a-z0-9-]+)/g)) slugs.add(m[1]);
	return [...slugs];
}

/** "ns00014933-lek-linge-wandelaars-langs-de-linge-bij-beesd.webp" → "Wandelaars langs de linge bij beesd" */
function captionFromFilename(url: string): string | null {
	const words = url
		.split('/')
		.at(-1)
		?.replace(/\.\w+$/, '')
		.replace(/^ns\d+-/, '')
		.split('-');
	if (!words?.length) return null;
	const sentence = words.join(' ');
	return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function parseWalkPage(html: string): NsWalkPage {
	const root = parse(html);

	// The "Bekijk route" button links to the matching Wandelnet route; theme pages don't have one.
	const cta = root.querySelector('a#cta-button')?.getAttribute('href') ?? '';
	const wandelnetId = cta.match(/wandelnet\.nl\/wandelroute\/(\d+)/)?.[1] ?? null;

	const facts = new Map<string, string>();
	for (const dl of root.querySelectorAll('dl')) {
		const dts = dl.querySelectorAll('dt');
		const dds = dl.querySelectorAll('dd');
		dts.forEach((dt, i) =>
			facts.set(dt.text.trim(), dds[i]?.text.replace(/\s+/g, ' ').trim() ?? '')
		);
	}

	const stations = root.text.match(/Van station (.+?) naar station (.+?)\./);

	const photos = new Map<string, string | null>();
	for (const img of root.querySelectorAll('img')) {
		const src = img.getAttribute('src') ?? '';
		if (!src.startsWith('https://ocp.ns.nl/')) continue;
		const large = src.replace(/\/(\d{3,4})\/([^/]+)$/, '/960/$2');
		photos.set(large, captionFromFilename(large));
	}

	const paved = facts.get('Percentage verhard')?.match(/\d+/)?.[0];
	return {
		wandelnetId,
		fromStation: stations?.[1].trim() ?? null,
		toStation: stations?.[2].trim() ?? null,
		pavedPct: paved ? Number(paved) : null,
		dogs: facts.get('Honden toegestaan') || null,
		goodToKnow: facts.get('Goed om te weten') || null,
		photos: [...photos].map(([url, caption]) => ({ url, caption }))
	};
}
