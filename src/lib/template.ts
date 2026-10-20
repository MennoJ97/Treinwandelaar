/**
 * Fill app.html's own placeholders (SvelteKit no longer fills env values in there): the site's
 * origin, the family site's stylesheet, script and link-preview image when FAMILY_SITE is set, and
 * Umami's tracker when UMAMI_WEBSITE_ID is.
 */
export function fillTemplate(
	html: string,
	origin: string,
	family: string | undefined,
	umami?: string
): string {
	// A page with a card of its own (a walk's page) keeps it: previews take the first og:image.
	const ownCard = html.includes('<meta property="og:image"');
	const familyHead = family
		? [
				...(ownCard
					? []
					: [
							`<meta property="og:image" content="${family}/og/treinwandelaar.png" />`,
							'<meta property="og:image:width" content="1200" />',
							'<meta property="og:image:height" content="630" />',
							'<meta property="og:image:alt" content="treinwandelaar — wandelen van station naar station" />'
						]),
				`<link rel="stylesheet" href="${family}/family.css" />`,
				`<script src="${family}/family.js"></script>`
			].join('\n\t\t')
		: '';
	// Same origin, so no third host and no CSP change: the proxy sends /_u/ to Umami. data-domains
	// keeps a dev server or a copy on another host out. The query string stays in the page views:
	// the app rewrites it only when you open a walk, pick a route or turn a walk around, never
	// while you type or pan. Without cookies, and Do Not Track is honoured.
	const analytics = umami
		? `<script defer src="/_u/script.js" data-website-id="${umami}" data-domains="${new URL(origin).hostname}" data-do-not-track="true"></script>`
		: '';
	return html
		.replaceAll('%treinwandelaar.origin%', origin)
		.replaceAll('%treinwandelaar.host%', new URL(origin).host)
		.replace('%treinwandelaar.family%', familyHead)
		.replace('%treinwandelaar.analytics%', analytics);
}
