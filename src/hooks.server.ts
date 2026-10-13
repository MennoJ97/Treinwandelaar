import type { Handle } from '@sveltejs/kit/hooks';
import { LOCAL_USER } from '#lib/server/db.js';

/**
 * Who is asking. Authentik's forward-auth adds X-authentik-username to every request it lets through,
 * and Traefik replaces any copy the client sent, so the header can be trusted as long as the app is
 * only reachable through Traefik. Without Authentik (local dev, a LAN-only setup) everyone is LOCAL_USER.
 */
export const handle: Handle = ({ event, resolve }) => {
	event.locals.user = event.request.headers.get('x-authentik-username') || LOCAL_USER;
	return resolve(event);
};
