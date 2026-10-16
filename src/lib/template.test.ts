import { describe, expect, it } from 'vitest';
import { fillTemplate } from './template';

const html = `<meta property="og:url" content="%treinwandelaar.origin%/" />
<meta property="og:site_name" content="%treinwandelaar.host%" />
%treinwandelaar.family%`;

describe('fillTemplate', () => {
	it('fills in the origin and the family site', () => {
		const out = fillTemplate(html, 'https://walks.example.org', 'https://example.org');
		expect(out).toContain('content="https://walks.example.org/"');
		expect(out).toContain('content="walks.example.org"');
		expect(out).toContain('<link rel="stylesheet" href="https://example.org/family.css" />');
		expect(out).toContain('<script src="https://example.org/family.js"></script>');
		expect(out).toContain('content="https://example.org/og/treinwandelaar.png"');
	});

	it('leaves the family out when there is none', () => {
		const out = fillTemplate(html, 'http://localhost:5173', undefined);
		expect(out).not.toContain('%');
		expect(out).not.toContain('family');
		expect(out).toContain('content="localhost:5173"');
	});
});
