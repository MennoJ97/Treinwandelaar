import { describe, expect, it } from 'vitest';
import { fillTemplate } from './template';

const html = `<meta property="og:url" content="%treinwandelaar.origin%/" />
<meta property="og:site_name" content="%treinwandelaar.host%" />
%treinwandelaar.family%
%treinwandelaar.analytics%`;

describe('fillTemplate', () => {
	it('fills in the origin and the family site', () => {
		const out = fillTemplate(html, 'https://walks.example.org', 'https://example.org');
		expect(out).toContain('content="https://walks.example.org/"');
		expect(out).toContain('content="walks.example.org"');
		expect(out).toContain('<link rel="stylesheet" href="https://example.org/family.css" />');
		expect(out).toContain('<script src="https://example.org/family.js"></script>');
		expect(out).toContain('content="https://example.org/og/treinwandelaar.png"');
	});

	it("leaves the site's card out of a page that has its own", () => {
		const page = `${html}\n<meta property="og:image" content="https://walks.example.org/route/osm:1/og.png?v=1" />`;
		const out = fillTemplate(page, 'https://walks.example.org', 'https://example.org');
		expect(out).not.toContain('og/treinwandelaar.png');
		expect(out.match(/property="og:image"/g)).toHaveLength(1);
		expect(out).toContain('family.css');
	});

	it('leaves the family out when there is none', () => {
		const out = fillTemplate(html, 'http://localhost:5173', undefined);
		expect(out).not.toContain('%');
		expect(out).not.toContain('family');
		expect(out).toContain('content="localhost:5173"');
		expect(out).not.toContain('_u/script.js');
	});

	it("loads Umami's tracker from its own host when there is a website id", () => {
		const id = 'c14f62d1-11d6-4d00-a637-b5e98067bf64';
		const out = fillTemplate(html, 'https://walks.example.org', undefined, id);
		expect(out).toContain(
			`<script defer src="/_u/script.js" data-website-id="${id}" data-domains="walks.example.org" data-do-not-track="true" data-performance="true"></script>`
		);
		expect(out).not.toContain('%');
	});
});
