import type { Handle } from '@sveltejs/kit/hooks';
import { FAMILY_SITE } from '$app/env/public';
import { fillTemplate } from '#lib/template.js';
import { compress } from '#lib/server/compress.js';
import { anonymousAccess, proxySecret } from '#lib/server/context.js';
import { requestUser } from '#lib/server/user.js';

export const handle: Handle = async ({ event, resolve }) => {
	// Who is asking: see requestUser for when X-authentik-username is believed.
	event.locals.user = requestUser(event.request.headers, proxySecret(), anonymousAccess());
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => fillTemplate(html, event.url.origin, FAMILY_SITE)
	});
	// A load's fetch to our own API is answered in-process and read as-is: leave it plain.
	return event.isSubRequest ? response : compress(event.request, response);
};
