import { describe, expect, it } from 'vitest';
import { normalize, searchStations } from './stationSearch';
import type { Station } from './types';

const st = (code: string, name: string): Station => ({ code, name, uic: null, lat: 0, lng: 0 });
const stations = [
	st('UT', 'Utrecht Centraal'),
	st('UTZL', 'Utrecht Zuilen'),
	st('UTO', 'Utrecht Overvecht'),
	st('HT', "'s-Hertogenbosch"),
	st('HTO', "'s-Hertogenbosch Oost"),
	st('GVC', 'Den Haag Centraal'),
	st('GV', 'Den Haag HS'),
	st('ASD', 'Amsterdam Centraal'),
	st('ZD', 'Zaandam'),
	st('BHV', 'Bilthoven')
];
const names = (q: string) => searchStations(stations, q).map((s) => s.name);

describe('station search', () => {
	it("normalizes accents, case and the 's- prefix", () => {
		expect(normalize("'s-Hertogenbosch Oost")).toBe('hertogenbosch oost');
		expect(normalize('Coevorden – Café')).toBe('coevorden cafe');
	});

	it('puts an exact NS code first', () => {
		expect(names('ut')[0]).toBe('Utrecht Centraal');
		expect(names('GV')[0]).toBe('Den Haag HS');
	});

	it('ranks prefix matches with Centraal first, then alphabetically', () => {
		expect(names('utr')).toEqual(['Utrecht Centraal', 'Utrecht Overvecht', 'Utrecht Zuilen']);
	});

	it('matches words in any position by their start', () => {
		expect(names('haag cen')).toEqual(['Den Haag Centraal']);
		expect(names('zuilen')).toEqual(['Utrecht Zuilen']);
	});

	it('understands common ways of naming a station', () => {
		expect(names('den bosch')).toEqual(["'s-Hertogenbosch", "'s-Hertogenbosch Oost"]);
		expect(names('den bo')).toEqual(["'s-Hertogenbosch", "'s-Hertogenbosch Oost"]);
		expect(names('the hag')).toEqual(['Den Haag Centraal', 'Den Haag HS']);
		expect(names('amsterdam cs')).toEqual(['Amsterdam Centraal']);
		expect(names('hertogenbosch')[0]).toBe("'s-Hertogenbosch");
	});

	it('falls back to substring matches and returns nothing for no match', () => {
		expect(names('thoven')).toEqual(['Bilthoven']);
		expect(names('xyz')).toEqual([]);
		expect(names('  ')).toEqual([]);
	});
});
