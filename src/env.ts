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
	HOME_STATION: {
		description: 'Default home station (NS code), e.g. UT for Utrecht Centraal.',
		schema: (value) => value || 'UT'
	}
});
