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
	HOME_STATION: {
		description: 'Default home station (NS code), e.g. UT for Utrecht Centraal.',
		schema: (value) => value || 'UT'
	}
});
