/**
 * The strip shows small, cropped versions; the viewer wants the biggest sensible one.
 * Each source has its own way of naming sizes, so map known patterns and fall back to the URL as-is.
 */
export function largePhoto(url: string): string {
	// ns.nl: .../landscape_ratio16x9/960/name.webp → the largest published width.
	if (url.startsWith('https://ocp.ns.nl/')) return url.replace(/\/\d{3,4}\/([^/]+)$/, '/1480/$1');
	// Wandelnet route headers: img-C1000x550.jpg → the widest crop they publish.
	if (url.includes('.routemaker.nl/content/img/'))
		return url.replace(/img-C\d+x\d+\.jpg$/, 'img-C2000x850.jpg');
	// Wandelnet library: scaleType=1 fits inside the box without cropping, so the whole photo shows.
	if (url.includes('wandelnet.nl/l/library/download/'))
		return `${url.split('?')[0]}?scaleType=1&width=1600&height=1600`;
	return url;
}
