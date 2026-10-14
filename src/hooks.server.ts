import type { Handle } from '@sveltejs/kit/hooks';
import { anonymousAccess } from '#lib/server/context.js';
import { LOCAL_USER } from '#lib/server/db.js';

/**
 * Who is asking. Authentik's forward-auth adds X-authentik-username to every request from a signed-in
 * user, also on the paths it lets through without login, and Traefik replaces any copy the client
 * sent; so the header can be trusted as long as the app is only reachable through Traefik.
 *
 * Without it, ANONYMOUS_ACCESS decides: 'demo' (the default) for the public demo, where Authentik lets
 * anonymous visitors through to everything but /login, or 'full' as the shared LOCAL_USER (local dev,
 * a LAN-only setup without Authentik).
 */
export const handle: Handle = ({ event, resolve }) => {
	event.locals.user =
		event.request.headers.get('x-authentik-username') ||
		(anonymousAccess() === 'demo' ? null : LOCAL_USER);
	return resolve(event);
};
