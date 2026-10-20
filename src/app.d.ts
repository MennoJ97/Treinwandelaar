// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/**
			 * Authentik username (src/hooks.server.ts); the personal layer is stored per user.
			 * Null for an anonymous visitor of the demo, who sees only the OpenStreetMap walks.
			 */
			user: string | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Window {
		/** Umami's tracker, when app.html loaded it (see lib/track.ts). */
		umami?: { track(event: string, data?: Record<string, string | number | boolean>): void };
	}
}

export {};
