/**
 * NS disruptions and planned engineering works, matched against routes from the offline planner.
 *
 * One call (/reisinformatie-api/api/v3/disruptions) returns everything current and announced:
 * MAINTENANCE (planned works, often weeks ahead), DISRUPTION and CALAMITY. Each names the affected
 * stretch as a list of stations. A route is affected when it *travels along* such a stretch on the
 * chosen day: two consecutive stops both inside it. Merely passing Utrecht Centraal, which ends many
 * stretches, doesn't count.
 *
 * The listed stretch is often the whole line ("Utrecht - Leiden") while the works close only part of
 * it; the situation text says which ("tussen Bodegraven en Alphen a/d Rijn rijden er bussen"). We
 * narrow each stretch to the stations between those two names when they can be found in it.
 */
import { normalize } from '../stationSearch';
import type { Disruption } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any -- NS payload, mapped defensively */

export interface Section {
	codes: string[];
	/** Normalized station names, same order as `codes`. */
	names: string[];
}

export interface Span {
	start: number;
	/** null: until further notice. */
	end: number | null;
	/** "tussen X en Y" pairs from the situation text, normalized; empty when there are none. */
	between: [string, string][];
}

export interface DisruptionWithSections extends Disruption {
	sections: Section[];
	spans: Span[];
	/** Touches a station abroad (DE/BE/FR). */
	international: boolean;
	/** NS's own 1–5 impact score. */
	impact: number;
}

const time = (iso: string | null | undefined) =>
	iso ? Date.parse(iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : NaN;

export function mapDisruption(d: any): DisruptionWithSections | null {
	const sections: Section[] = (d.publicationSections ?? [])
		.map((p: any) => {
			const stations = p.section?.stations ?? [];
			return {
				codes: stations.map((s: any) => String(s.stationCode ?? '').toUpperCase()),
				names: stations.map((s: any) => normalize(String(s.name ?? '')))
			};
		})
		.filter((s: Section) => s.codes.length >= 2);
	if (!sections.length) return null;
	const spans: Span[] = (d.timespans?.length ? d.timespans : [{ start: d.start, end: d.end }])
		.map((t: any) => ({
			start: time(t.start),
			end: Number.isNaN(time(t.end)) ? null : time(t.end),
			between: betweenPairs(t.situation?.label ?? d.situation?.label ?? '')
		}))
		.filter((t: Span) => !Number.isNaN(t.start));
	const span = d.timespans?.[0];
	const international = (d.publicationSections ?? []).some((p: any) =>
		(p.section?.stations ?? []).some((s: any) => s.countryCode && s.countryCode !== 'NL')
	);
	return {
		id: String(d.id),
		type: d.type === 'MAINTENANCE' ? 'werkzaamheden' : 'storing',
		title: String(d.title ?? '').replace(/\.$/, ''),
		period: d.period ?? span?.period ?? null,
		periodShort: shortPeriod(spans),
		situation: span?.situation?.label ?? d.situation?.label ?? null,
		advices: [...new Set<string>((d.timespans ?? []).flatMap((t: any) => t.advices ?? []))],
		sections,
		spans,
		international,
		impact: Number(d.impact?.value ?? 3)
	};
}

/**
 * Worth flagging on a domestic day trip? Cross-border items with low impact ("Amsterdam - Berlin",
 * "Lelystad - Brussel", impact 2) concern the international trains, but list the Dutch track they
 * run on, so they'd flag every route sharing it. Higher-impact cross-border works (Maastricht -
 * Liège, impact 4) do close track that local trains use too, so those stay.
 */
export function relevant(d: DisruptionWithSections): boolean {
	return !(d.international && d.impact <= 2);
}

const dayFmt = (ms: number, opts: Intl.DateTimeFormatOptions) =>
	new Date(ms)
		.toLocaleDateString('nl-NL', { timeZone: 'Europe/Amsterdam', ...opts })
		.replace('.', '');

/**
 * A compact period for a title: "17 okt", "16–18 okt", "28 sep – 3 okt", "t/m 14 jul 2027",
 * "vanaf 12 okt". Works ending in the small hours (NS: "t/m maandag 2:00 uur") end the day before.
 */
export function shortPeriod(spans: Span[], now = Date.now()): string | null {
	if (!spans.length) return null;
	const start = Math.min(...spans.map((s) => s.start));
	const ends = spans.map((s) => s.end);
	if (ends.some((e) => e === null))
		return start <= now
			? 'tot nader bericht'
			: `vanaf ${dayFmt(start, { day: 'numeric', month: 'short' })}`;
	let end = Math.max(...(ends as number[]));
	const endHour = Number(
		new Date(end).toLocaleString('en-GB', {
			hour: '2-digit',
			hour12: false,
			timeZone: 'Europe/Amsterdam'
		})
	);
	if (endHour < 5) end -= 6 * 3600_000;
	const year = (ms: number) => dayFmt(ms, { year: 'numeric' });
	const thisYear = year(now);
	const withYear = (ms: number, base: Intl.DateTimeFormatOptions) =>
		dayFmt(ms, year(ms) === thisYear ? base : { ...base, year: 'numeric' });
	const md = { day: 'numeric', month: 'short' } as const;
	// Running for a while already: only the end is news.
	if (start < now - 2 * 24 * 3600_000) return `t/m ${withYear(end, md)}`;
	const sameDay = dayFmt(start, md) === dayFmt(end, md) && year(start) === year(end);
	if (sameDay) return withYear(start, md);
	const sameMonth =
		dayFmt(start, { month: 'short', year: 'numeric' }) ===
		dayFmt(end, { month: 'short', year: 'numeric' });
	if (sameMonth) return `${dayFmt(start, { day: 'numeric' })}–${withYear(end, md)}`;
	return `${withYear(start, md)} – ${withYear(end, md)}`;
}

/** "…tussen Amersfoort Centraal en Apeldoorn rijden er bussen en tussen A en B…" → name pairs. */
export function betweenPairs(text: string): [string, string][] {
	const pairs: [string, string][] = [];
	const pattern =
		/tussen (.+?) en (.+?)(?= rijd| is | zijn| gaan| geen| minder| kun|\.|,| en tussen|$)/gi;
	for (const m of text.matchAll(pattern)) pairs.push([normalize(m[1]), normalize(m[2])]);
	return pairs;
}

/**
 * The part of a day a day trip uses: 06:00 to midnight (Amsterdam). Night-only works (01:00–05:00)
 * don't touch it.
 */
export function travelDay(ymd: string): [number, number] {
	const start = Date.parse(`${ymd}T06:00:00${amsterdamOffset(ymd)}`);
	return [start, start + 18 * 3600_000];
}

function amsterdamOffset(ymd: string): string {
	const label = new Date(`${ymd}T12:00:00Z`).toLocaleString('en-US', {
		timeZone: 'Europe/Amsterdam',
		timeZoneName: 'longOffset'
	});
	return label.match(/GMT([+-]\d{2}:\d{2})/)?.[1] ?? '+00:00';
}

function activeSpans(d: DisruptionWithSections, ymd: string): Span[] {
	const [dayStart, dayEnd] = travelDay(ymd);
	return d.spans.filter((s) => s.start < dayEnd && (s.end === null || s.end > dayStart));
}

export function activeOn(d: DisruptionWithSections, ymd: string): boolean {
	return activeSpans(d, ymd).length > 0;
}

/**
 * The station sets actually affected on that day: each section narrowed to the stretch between the
 * named stations of the active timespans, or the whole section when the text names none we can find.
 */
export function affectedStretches(d: DisruptionWithSections, ymd: string): Set<string>[] {
	const pairs = activeSpans(d, ymd).flatMap((s) => s.between);
	const stretches: Set<string>[] = [];
	for (const section of d.sections) {
		let narrowed = false;
		for (const [a, b] of pairs) {
			const i = section.names.indexOf(a);
			const j = section.names.indexOf(b);
			if (i < 0 || j < 0) continue;
			stretches.push(new Set(section.codes.slice(Math.min(i, j), Math.max(i, j) + 1)));
			narrowed = true;
		}
		if (!narrowed) stretches.push(new Set(section.codes));
	}
	return stretches;
}

/** Does a route (its travelled stretches) run along any affected stretch? */
export function affectsRoute(stretches: Set<string>[], edges: [string, string][]): boolean {
	return stretches.some((inStretch) =>
		edges.some(([a, b]) => inStretch.has(a) && inStretch.has(b))
	);
}
