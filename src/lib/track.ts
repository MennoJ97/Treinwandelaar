/**
 * Custom events for the site's Umami (the tag in app.html). Page views count themselves, client
 * navigation included: the tracker hooks pushState and replaceState. Only ids and station codes go
 * in here, never a username, a note or anything else a visitor typed.
 *
 * Without the tracker (a dev server, another host, Do Not Track, a blocker) this does nothing.
 */
export function track(event: string, data?: Record<string, string | number | boolean>) {
	try {
		window.umami?.track(event, data);
	} catch {
		/* analytics never gets in the way */
	}
}
