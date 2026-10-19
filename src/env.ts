import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	NS_API_KEY: {
		description:
			'NS API subscription key (apiportal.ns.nl). Optional: without it, train times are off.',
		schema: (value) => value || undefined
	},
	DATABASE_PATH: {
		description: 'SQLite database file, filled by `npm run ingest`.',
		schema: (value) => value || 'data/treinwandelaar.db'
	},
	ANONYMOUS_ACCESS: {
		description:
			"What visitors without an X-authentik-username get: 'demo' (the default: only the " +
			"OpenStreetMap walks, nothing saved) or 'full' (everything, as user 'local'; for local or " +
			'LAN-only use).',
		// Fails closed: a typo or a missing .env never opens Wandelnet's data to anonymous visitors.
		schema: (value) => (value === 'full' ? 'full' : 'demo')
	},
	PROXY_SECRET: {
		description:
			'Shared with the reverse proxy, which sends it as X-Proxy-Secret on every request. When set, ' +
			'X-authentik-username counts only on requests that carry it, so a client that reaches the ' +
			"app's port without the proxy can't pick a user. Optional: unset, the header is always believed.",
		schema: (value) => value || undefined
	},
	FAMILY_SITE: {
		description:
			'Origin of the site this app belongs to (e.g. https://example.org), which serves family.css, ' +
			'family.js and the link-preview image, and which the header links back to. Optional: without ' +
			'it the app uses its own greys and type and shows no light/dark switch.',
		public: true,
		schema: (value) => (value ? new URL(value).origin : undefined)
	},
	HOME_STATION: {
		description: 'Default home station (NS code), e.g. UT for Utrecht Centraal.',
		schema: (value) => value || 'UT'
	}
});
