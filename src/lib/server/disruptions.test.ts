import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	activeOn,
	affectedStretches,
	affectsRoute,
	betweenPairs,
	mapDisruption,
	shortPeriod
} from './disruptions';

// Recorded from the NS disruptions API: buses between Leeuwarden and Stavoren, 10–18 October 2026.
const raw = JSON.parse(
	readFileSync(new URL('./__fixtures__/ns-disruption-lw-stavoren.json', import.meta.url), 'utf8')
);
const d = mapDisruption(raw)!;

describe('disruptions', () => {
	it('drops low-impact cross-border items but keeps ones that close shared track', async () => {
		const { relevant } = await import('./disruptions');
		expect(relevant(d)).toBe(true);
		expect(relevant({ ...d, international: true, impact: 2 })).toBe(false);
		expect(relevant({ ...d, international: true, impact: 4 })).toBe(true);
	});

	it('maps the NS record', () => {
		expect(d).toMatchObject({
			id: '7008338',
			type: 'werkzaamheden',
			title: 'Leeuwarden - Stavoren'
		});
		expect(d.situation).toMatch(/rijden er bussen/);
		expect(d.sections[0].codes[0]).toBe('LW');
		expect(d.sections[0].codes).toContain('SK');
	});

	it('knows which days it applies to', () => {
		expect(activeOn(d, '2026-10-17')).toBe(true);
		expect(activeOn(d, '2026-10-18')).toBe(false); // ends 01:00 on the 18th, before that service day
		expect(activeOn(d, '2026-10-09')).toBe(false);
	});

	it('affects routes that travel along the stretch, not ones that only touch its end', () => {
		const stretches = affectedStretches(d, '2026-10-17');
		expect(
			affectsRoute(stretches, [
				['LW', 'MG'],
				['MG', 'SKND']
			])
		).toBe(true);
		expect(
			affectsRoute(stretches, [
				['ZL', 'HR'],
				['HR', 'LW']
			])
		).toBe(false); // arriving at Leeuwarden
	});

	it('reads the closed part from the situation text', () => {
		expect(
			betweenPairs(
				'Door werkzaamheden: tussen Amersfoort Centraal en Apeldoorn rijden er bussen en tussen Amersfoort Centraal en Zwolle rijden er minder treinen.'
			)
		).toEqual([
			['amersfoort centraal', 'apeldoorn'],
			['amersfoort centraal', 'zwolle']
		]);
	});

	it('narrows a whole-line section to the stretch that is actually closed', () => {
		const line = {
			...d,
			sections: [
				{
					codes: ['UT', 'UTT', 'WD', 'BDG', 'APN', 'LDL'],
					names: [
						'utrecht centraal',
						'utrecht terwijde',
						'woerden',
						'bodegraven',
						'alphen a d rijn',
						'leiden lammenschans'
					]
				}
			],
			spans: [
				{
					start: Date.parse('2026-10-12T04:00:00+02:00'),
					end: null,
					between: betweenPairs('tussen Bodegraven en Alphen a/d Rijn rijden er bussen')
				}
			]
		};
		const stretches = affectedStretches(line, '2026-10-17');
		expect([...stretches[0]]).toEqual(['BDG', 'APN']);
		expect(
			affectsRoute(stretches, [
				['UT', 'UTT'],
				['UTT', 'WD']
			])
		).toBe(false); // Utrecht → Woerden
		expect(
			affectsRoute(stretches, [
				['WD', 'BDG'],
				['BDG', 'APN']
			])
		).toBe(true);
	});

	it('gives a compact period for the collapsed title', () => {
		const at = (iso: string) => Date.parse(iso);
		const now = at('2026-10-13T12:00:00+02:00');
		const span = (a: string, b: string | null) => ({
			start: at(a),
			end: b ? at(b) : null,
			between: []
		});
		// Ends at 02:00 on the 19th: really through the 18th.
		expect(shortPeriod([span('2026-10-16T04:45:00+02:00', '2026-10-19T02:00:00+02:00')], now)).toBe(
			'16–18 okt'
		);
		expect(shortPeriod([span('2026-10-17T05:00:00+02:00', '2026-10-17T23:00:00+02:00')], now)).toBe(
			'17 okt'
		);
		expect(shortPeriod([span('2026-10-28T05:00:00+01:00', '2026-11-03T02:00:00+01:00')], now)).toBe(
			'28 okt – 2 nov'
		);
		expect(shortPeriod([span('2026-10-01T04:00:00+02:00', '2027-07-14T02:00:00+02:00')], now)).toBe(
			't/m 13 jul 2027'
		);
		expect(shortPeriod([span('2026-10-12T08:00:00+02:00', null)], now)).toBe('tot nader bericht');
		// Leeuwarden–Stavoren, running since the 10th: only the end is news.
		expect(shortPeriod(d.spans, now)).toBe('t/m 17 okt');
		// Seen before it started, the whole range.
		expect(shortPeriod(d.spans, at('2026-10-01T12:00:00+02:00'))).toBe('10–17 okt');
	});
});
