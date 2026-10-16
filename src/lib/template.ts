/**
 * Fill app.html's own placeholders (SvelteKit no longer fills env values in there): the site's
 * origin, and the family site's stylesheet, script and link-preview image when FAMILY_SITE is set.
 */
export function fillTemplate(html: string, origin: string, family: string | undefined): string {
	const familyHead = family
		? [
				`<meta property="og:image" content="${family}/og/treinwandelaar.png" />`,
				'<meta property="og:image:width" content="1200" />',
				'<meta property="og:image:height" content="630" />',
				'<meta property="og:image:alt" content="treinwandelaar — wandelen van station naar station" />',
				`<link rel="stylesheet" href="${family}/family.css" />`,
				`<script src="${family}/family.js"></script>`
			].join('\n\t\t')
		: '';
	return html
		.replaceAll('%treinwandelaar.origin%', origin)
		.replaceAll('%treinwandelaar.host%', new URL(origin).host)
		.replace('%treinwandelaar.family%', familyHead);
}
