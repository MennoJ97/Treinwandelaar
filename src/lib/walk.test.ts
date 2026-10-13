import { describe, expect, it } from 'vitest';
import { wandelnetCredit } from './walk';

describe('wandelnetCredit', () => {
	it('dates the credit the Dutch way', () => {
		expect(wandelnetCredit('2026-10-12')).toBe(
			'Routedata © Stichting Wandelnet, bijgewerkt 12-10-2026'
		);
	});

	it('leaves the date out until an ingest has recorded one', () => {
		expect(wandelnetCredit(null)).toBe('Routedata © Stichting Wandelnet');
	});
});
