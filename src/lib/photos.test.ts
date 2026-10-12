import { describe, expect, it } from 'vitest';
import { largePhoto } from './photos';

describe('largePhoto', () => {
	it('picks the largest variant per source', () => {
		expect(
			largePhoto(
				'https://ocp.ns.nl/caas/v1/media/stable/145412/data/landscape_ratio16x9/960/ns00014933-lek-linge.webp'
			)
		).toBe(
			'https://ocp.ns.nl/caas/v1/media/stable/145412/data/landscape_ratio16x9/1480/ns00014933-lek-linge.webp'
		);
		expect(
			largePhoto('https://wandelnet.api.routemaker.nl/content/img/5878/img-C1000x550.jpg')
		).toBe('https://wandelnet.api.routemaker.nl/content/img/5878/img-C2000x850.jpg');
		expect(
			largePhoto(
				'https://www.wandelnet.nl/l/library/download/urn:uuid:52f7/amelisweerd.jpg?scaleType=3&width=800&height=400'
			)
		).toBe(
			'https://www.wandelnet.nl/l/library/download/urn:uuid:52f7/amelisweerd.jpg?scaleType=1&width=1600&height=1600'
		);
		expect(largePhoto('https://example.org/a.jpg')).toBe('https://example.org/a.jpg');
	});
});
