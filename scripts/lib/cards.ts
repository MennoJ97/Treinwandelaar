/**
 * A link-preview card per public walk (og:image on /route/<id>): 1200x630, in the style of the family
 * sites' cards (web/tools/make-og.py in the compose repo), with the walk's route in a column of its
 * own. Drawn as SVG with the text as outlines (opentype.js, Nimbus Sans: the metric clone of the
 * Helvetica the family is set in), rasterised by sharp and cut to 64 colours, ~12 kB each.
 *
 * Only OpenStreetMap's walks get one: they're the only ones anonymous visitors see. The cards live
 * next to the database (data/og/), never in git. A card is drawn again only when its SVG changes,
 * and cards of walks that are gone are deleted.
 */
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
// CommonJS: Node sees only a default export.
import opentype, { type Font } from 'opentype.js';
import sharp from 'sharp';
import { haversine, simplify, type LngLat } from '../../src/lib/geo';
import type { WalkListItem } from '../../src/lib/types';
import { formatKm, walkHeading } from '../../src/lib/walk';

const W = 1200;
const H = 630;
const LEFT = 96;
const TEXT_W = 600;
/** The route's own column. */
const BOX = { x: 744, y: 60, w: 360, h: 510 };
const COLOURS = {
	bg: '#F5F5F3',
	ink: '#111111',
	muted: '#666663',
	navy: '#003082',
	yellow: '#FFC917'
};

/** The logo (src/lib/components/Mark.svelte), in its 34x22 viewBox. */
const MARK = `<rect width="34" height="22" rx="3" fill="${COLOURS.yellow}"/>
<g fill="none" stroke-width="2.6" stroke="${COLOURS.navy}"><path d="M8 17h3.5"/>
<path d="M16.5 17H29.9" stroke-dasharray="2 1.8"/>
<circle cx="5.5" cy="17" r="2.4" fill="${COLOURS.yellow}"/><circle cx="14" cy="17" r="2.4" fill="${COLOURS.yellow}"/></g>
<g transform="translate(24.5 15.8) scale(0.64)" fill="${COLOURS.navy}" stroke="${COLOURS.navy}">
<g fill="none" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
<path d="M1.4-15.2-.4-8.4"/><path d="M-.4-8.4 1.9-4.4 4.2 0"/><path d="M-.4-8.4-2.1-4.2-5-1"/>
<path d="M1.1-14 3-11.2 5.2-10.2"/><path d="M1.1-14-.9-11.3-3-9.8"/></g>
<circle cx="2.4" cy="-19.4" r="2.7" stroke="none"/></g>`;

/** Next to the database, like the OSM extract: data/og/<id>.png, served by /route/<id>/og.png. */
export const CARD_DIR = join(dirname(process.env.DATABASE_PATH ?? 'data/treinwandelaar.db'), 'og');

/**
 * The site's host for the card's bottom row: from ORIGIN, or from DOMAIN as in the deployment's
 * .env. Never written in the repository; without either the row just says "treinwandelaar".
 */
export function cardHost(): string | null {
	if (process.env.ORIGIN) return new URL(process.env.ORIGIN).host;
	return process.env.DOMAIN ? `treinwandelaar.${process.env.DOMAIN}` : null;
}

/** Where Debian's fonts-urw-base35 puts Nimbus Sans; CARD_FONT_DIR elsewhere. */
const FONT_DIR = process.env.CARD_FONT_DIR ?? '/usr/share/fonts/opentype/urw-base35';

export interface CardFonts {
	bold: Font;
	regular: Font;
}

export function loadFonts(dir = FONT_DIR): CardFonts {
	const load = (file: string) => {
		const b = readFileSync(join(dir, file));
		return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
	};
	return { bold: load('NimbusSans-Bold.otf'), regular: load('NimbusSans-Regular.otf') };
}

/** Lines of at most `width` px; a word too long for a line gets one of its own. */
export function wrap(font: Font, text: string, size: number, width: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const trial = line ? `${line} ${word}` : word;
		if (line && measure(font, trial, size) > width) {
			lines.push(line);
			line = word;
		} else line = trial;
	}
	return line ? [...lines, line] : lines;
}

/** At most `max` lines, the last one cut short with an ellipsis if there's more. */
function fitLines(font: Font, text: string, size: number, width: number, max: number) {
	const lines = wrap(font, text, size, width);
	if (lines.length <= max) return lines;
	const kept = lines.slice(0, max);
	let last = `${kept[max - 1]} ${lines[max]}`;
	while (last && measure(font, `${last}…`, size) > width) last = last.replace(/\s*\S+$/, '');
	kept[max - 1] = `${last}…`;
	return kept;
}

const capHeight = (font: Font, size: number) =>
	((font.tables.os2 as { sCapHeight: number }).sCapHeight / font.unitsPerEm) * size;

/**
 * Text as an outline, glyph by glyph, with our own path data: opentype.js 2's toPathData() writes
 * the odd control point as NaN with Nimbus Sans, and librsvg stops drawing at the first NaN.
 */
function text(font: Font, s: string, x: number, y: number, size: number, fill: string) {
	const scale = size / font.unitsPerEm;
	const parts: string[] = [];
	let prev: ReturnType<Font['charToGlyph']> | null = null;
	for (const ch of s) {
		const glyph = font.charToGlyph(ch);
		if (prev) x += (font.getKerningValue(prev, glyph) || 0) * scale;
		parts.push(pathData(glyph.getPath(x, y, size)));
		x += (glyph.advanceWidth ?? 0) * scale;
		prev = glyph;
	}
	return `<path fill="${fill}" d="${parts.join('')}"/>`;
}

/** SVG path data with one decimal, from the commands themselves: see text(). */
function pathData(path: ReturnType<Font['getPath']>) {
	const n = (v: number) => (Math.round(v * 10) / 10).toString();
	return path.commands
		.map((c) =>
			c.type === 'M' || c.type === 'L'
				? `${c.type}${n(c.x)} ${n(c.y)}`
				: c.type === 'C'
					? `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`
					: c.type === 'Q'
						? `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`
						: 'Z'
		)
		.join('');
}

/** Width of a line of text, as text() sets it. */
function measure(font: Font, s: string, size: number) {
	const scale = size / font.unitsPerEm;
	let width = 0;
	let prev: ReturnType<Font['charToGlyph']> | null = null;
	for (const ch of s) {
		const glyph = font.charToGlyph(ch);
		if (prev) width += (font.getKerningValue(prev, glyph) || 0) * scale;
		width += (glyph.advanceWidth ?? 0) * scale;
		prev = glyph;
	}
	return width;
}

export interface CardWalk {
	id: string;
	name: string;
	isLoop: boolean;
	distanceKm: number;
	geometry: LngLat[];
	start: { name: string; at: LngLat } | null;
	end: { name: string; at: LngLat } | null;
}

/** The route and its stations, fitted into BOX with the aspect kept (north up). */
function routeSvg(walk: CardWalk): string {
	const stations = (walk.isLoop ? [walk.start] : [walk.start, walk.end]).filter(
		(s): s is NonNullable<typeof s> => !!s
	);
	const all = [...walk.geometry, ...stations.map((s) => s.at)];
	const kx = Math.cos((all[0][1] * Math.PI) / 180);
	const xs = all.map(([lng]) => lng * kx);
	const ys = all.map(([, lat]) => -lat);
	const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
	// Room for a station's circle (r 15, 8 px outline) at the edge.
	const pad = 24;
	const scale = Math.min(
		(BOX.w - 2 * pad) / (x1 - x0 || 1e-9),
		(BOX.h - 2 * pad) / (y1 - y0 || 1e-9)
	);
	const ox = BOX.x + (BOX.w - (x1 - x0) * scale) / 2;
	const oy = BOX.y + (BOX.h - (y1 - y0) * scale) / 2;
	const px = ([lng, lat]: LngLat) =>
		`${((lng * kx - x0) * scale + ox).toFixed(1)} ${((-lat - y0) * scale + oy).toFixed(1)}`;
	// Half a pixel of detail is all the card can show.
	const metresPerPx = ((1 / scale) * Math.PI * 6_371_000) / 180;
	const line = simplify(walk.geometry, metresPerPx / 2);
	const svg: string[] = [];
	// The walk between the platform and the route, dashed like the walk in the site's card.
	const links = [
		[walk.start, walk.geometry[0]],
		[walk.isLoop ? null : walk.end, walk.geometry.at(-1)!]
	] as const;
	for (const [station, end] of links)
		if (station && haversine(station.at, end) > 100)
			svg.push(
				`<path d="M${px(station.at)}L${px(end)}" fill="none" stroke="${COLOURS.navy}" stroke-width="6" stroke-dasharray="12 10" stroke-linecap="round"/>`
			);
	svg.push(
		`<path d="M${line.map(px).join('L')}" fill="none" stroke="${COLOURS.navy}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>`
	);
	for (const s of stations) {
		const [cx, cy] = px(s.at).split(' ');
		svg.push(
			`<circle cx="${cx}" cy="${cy}" r="15" fill="${COLOURS.yellow}" stroke="${COLOURS.navy}" stroke-width="8"/>`
		);
	}
	return svg.join('');
}

/** The card as SVG; the same walk always gives the same SVG, so its hash says when to draw again. */
export function cardSvg(walk: CardWalk, heading: string, fonts: CardFonts, host: string | null) {
	const out: string[] = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
		`<rect width="${W}" height="${H}" fill="${COLOURS.bg}"/>`
	];
	// The name: two lines at 64 px, or three a size down, cut short past that.
	let size = 64;
	let lines = wrap(fonts.bold, heading, size, TEXT_W);
	if (lines.length > 2) {
		size = 54;
		lines = fitLines(fonts.bold, heading, size, TEXT_W, 3);
	}
	let y = 100 + capHeight(fonts.bold, size);
	for (const l of lines) {
		out.push(text(fonts.bold, l, LEFT, y, size, COLOURS.ink));
		y += Math.round(size * 1.18);
	}
	// Then the distance, and where it starts and ends.
	const muted = 40;
	y += 18;
	const from = walk.start?.name ?? '?';
	const route = walk.isLoop ? `Rondje vanaf station ${from}` : `${from} → ${walk.end?.name ?? '?'}`;
	for (const l of [
		`${formatKm(walk.distanceKm)} km`,
		...fitLines(fonts.regular, route, muted, TEXT_W, 2)
	]) {
		out.push(text(fonts.regular, l, LEFT, y, muted, COLOURS.muted));
		y += 54;
	}
	// The host row, as on every family card: the logo, then the site's name with its caps centred.
	const top = 512;
	const markH = (48 / 34) * 22;
	out.push(
		`<g transform="translate(${LEFT} ${top + (40 - markH) / 2}) scale(${48 / 34})">${MARK}</g>`
	);
	const label = host ?? 'treinwandelaar';
	out.push(
		text(
			fonts.bold,
			label,
			LEFT + 48 + 22,
			top + (40 + capHeight(fonts.bold, 40)) / 2,
			40,
			COLOURS.ink
		)
	);
	out.push(routeSvg(walk), '</svg>');
	return out.join('\n');
}

/** Card file of a walk: ids are letters, digits, '-' and ':', and no id has a '_'. */
export const cardFile = (id: string) => `${id.replaceAll(':', '_')}.png`;

export async function renderPng(svg: string): Promise<Buffer> {
	return sharp(Buffer.from(svg))
		.png({ palette: true, colours: 64, dither: 0, compressionLevel: 9, effort: 10 })
		.toBuffer();
}

interface CardRow {
	id: string;
	name: string;
	source: 'osm';
	is_loop: number;
	distance_km: number;
	geometry: string;
	start_name: string | null;
	start_lat: number | null;
	start_lng: number | null;
	end_name: string | null;
	end_lat: number | null;
	end_lng: number | null;
	og_card: string | null;
}

/**
 * Draw the cards of every OSM walk whose card changed (or is missing) into `dir`, record each one's
 * version in walks.og_card, and delete the cards of walks that are gone.
 */
export async function renderCards(db: DatabaseSync, dir: string, host: string | null) {
	mkdirSync(dir, { recursive: true });
	const fonts = loadFonts();
	const rows = db
		.prepare(
			`select w.id, w.name, w.source, w.is_loop, w.distance_km, w.geometry, w.og_card,
				s1.name as start_name, s1.lat as start_lat, s1.lng as start_lng,
				s2.name as end_name, s2.lat as end_lat, s2.lng as end_lng
			 from walks w
			 left join stations s1 on s1.code = w.start_station
			 left join stations s2 on s2.code = w.end_station
			 where w.source = 'osm'`
		)
		.all() as unknown as CardRow[];
	const record = db.prepare('update walks set og_card = ? where id = ?');
	let drawn = 0;
	const queue = [...rows];
	const work = async () => {
		for (let r = queue.shift(); r; r = queue.shift()) {
			const station = (name: string | null, lat: number | null, lng: number | null) =>
				name != null && lat != null && lng != null ? { name, at: [lng, lat] as LngLat } : null;
			const walk: CardWalk = {
				id: r.id,
				name: r.name,
				isLoop: !!r.is_loop,
				distanceKm: r.distance_km,
				geometry: JSON.parse(r.geometry),
				start: station(r.start_name, r.start_lat, r.start_lng),
				end: station(r.end_name, r.end_lat, r.end_lng)
			};
			const heading = walkHeading({
				source: r.source,
				name: r.name,
				startStationName: r.start_name,
				endStationName: r.end_name
			} as WalkListItem);
			const svg = cardSvg(walk, heading, fonts, host);
			const version = createHash('sha256').update(svg).digest('hex').slice(0, 12);
			const file = join(dir, cardFile(r.id));
			if (r.og_card === version && existsSync(file)) continue;
			writeFileSync(`${file}.part`, await renderPng(svg));
			renameSync(`${file}.part`, file);
			record.run(version, r.id);
			drawn++;
		}
	};
	await Promise.all([work(), work(), work(), work()]);
	const keep = new Set(rows.map((r) => cardFile(r.id)));
	const stale = readdirSync(dir).filter((f) => !keep.has(f));
	for (const f of stale) unlinkSync(join(dir, f));
	return { walks: rows.length, drawn, deleted: stale.length };
}
