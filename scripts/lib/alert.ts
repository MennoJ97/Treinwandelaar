/**
 * Tell the operator an ingest needs a look, for failures that would otherwise only reach a log.
 *
 * Posts `message` as plain text to ALERT_WEBHOOK_URL (an ntfy topic URL, say), with `title` in a
 * Title header, and ALERT_WEBHOOK_AUTH as the Authorization header when set ("Bearer tk_…"). Unset
 * URL: logs only. Never throws: a failed alert is logged and the ingest carries on.
 */
export async function alert(title: string, message: string): Promise<void> {
	const url = process.env.ALERT_WEBHOOK_URL?.trim();
	if (!url) {
		console.warn(`No ALERT_WEBHOOK_URL set, so not sent: ${title}`);
		return;
	}
	const headers: Record<string, string> = {
		'Content-Type': 'text/plain; charset=utf-8',
		// HTTP headers are Latin-1; ntfy reads anything else in the title as mojibake.
		Title: title.replace(/[^\x20-\x7e]/g, '-'),
		Tags: 'warning'
	};
	const auth = process.env.ALERT_WEBHOOK_AUTH?.trim();
	if (auth) headers.Authorization = auth;
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers,
			body: message,
			signal: AbortSignal.timeout(15_000)
		});
		if (!res.ok) console.warn(`Alert not sent: ${res.status} ${res.statusText}`);
	} catch (err) {
		console.warn(`Alert not sent: ${(err as Error).message}`);
	}
}
