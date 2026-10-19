import { timingSafeEqual } from 'node:crypto';
import { LOCAL_USER } from './db';

/**
 * Who is asking. Authentik's forward-auth adds X-authentik-username to every request from a signed-in
 * user, also on the paths it lets through without login, and Traefik replaces any copy the client
 * sent. That only holds for requests that came through Traefik: anything else that can reach the app's
 * port (another container on the same Docker network, say) could send the header itself and act as any
 * user. So with PROXY_SECRET set, the header counts only on requests that also carry X-Proxy-Secret with
 * that value, which a Traefik headers middleware adds on the way in. Without PROXY_SECRET the header is
 * believed as before (local dev, or a setup where nothing but the proxy can reach the port).
 *
 * Without a username, ANONYMOUS_ACCESS decides: 'demo' (the default) for the public demo, where
 * Authentik lets anonymous visitors through to everything but /login, or 'full' as the shared
 * LOCAL_USER (local dev, a LAN-only setup without Authentik).
 */
export function requestUser(
	headers: Headers,
	proxySecret: string | undefined,
	anonymousAccess: 'demo' | 'full'
): string | null {
	const viaProxy = !proxySecret || sameSecret(headers.get('x-proxy-secret'), proxySecret);
	const username = viaProxy ? headers.get('x-authentik-username') : null;
	return username || (anonymousAccess === 'demo' ? null : LOCAL_USER);
}

/** Constant-time, so the secret can't be guessed a byte at a time from response timings. */
function sameSecret(given: string | null, secret: string): boolean {
	if (given === null) return false;
	const a = Buffer.from(given);
	const b = Buffer.from(secret);
	return a.length === b.length && timingSafeEqual(a, b);
}
