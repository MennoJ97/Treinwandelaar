import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { cardFile, cardSvg, loadFonts, renderPng, wrap, type CardWalk } from './cards';

// Nimbus Sans (fonts-urw-base35) is in the Docker image; elsewhere point CARD_FONT_DIR at it.
const fontDir = process.env.CARD_FONT_DIR ?? '/usr/share/fonts/opentype/urw-base35';
const haveFonts = existsSync(join(fontDir, 'NimbusSans-Bold.otf'));

const walk: CardWalk = {
	id: 'osm:21255748:GZ-BD',
	name: 'Oranje-Nassaupad etappe 5: Rijen-Breda',
	isLoop: false,
	distanceKm: 18.6,
	geometry: [
		[4.96, 51.57],
		[4.9, 51.6],
		[4.78, 51.59]
	],
	start: { name: 'Gilze-Rijen', at: [4.95, 51.57] },
	end: { name: 'Breda', at: [4.78, 51.595] }
};

describe('link-preview cards', () => {
	it('name their files after the walk', () => {
		expect(cardFile('osm:21255748:GZ-BD')).toBe('osm_21255748_GZ-BD.png');
	});

	it.skipIf(!haveFonts)('draw the walk in 64 colours, the same every time', async () => {
		const fonts = loadFonts(fontDir);
		// Too wide for two lines at 64 px: the card sets it a size down, in three.
		expect(wrap(fonts.bold, walk.name, 64, 600)).toHaveLength(3);
		const svg = cardSvg(walk, walk.name, fonts, 'walks.example.org');
		expect(svg).not.toContain('NaN');
		expect(cardSvg(walk, walk.name, fonts, 'walks.example.org')).toBe(svg);
		// Two stations, and the walk from Gilze-Rijen's platform to the route, dashed.
		expect(svg.match(/<circle [^>]*r="15"/g)).toHaveLength(2);
		expect(svg).toContain('stroke-dasharray="12 10"');
		const png = await renderPng(svg);
		const meta = await sharp(png).metadata();
		expect([meta.width, meta.height, meta.format]).toEqual([1200, 630, 'png']);
		expect(png.length).toBeLessThan(40_000);
	});
});
