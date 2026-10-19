import { describe, expect, it } from 'vitest';
import { LOCAL_USER } from './db';
import { requestUser } from './user';

const SECRET = 'f00dfeed'.repeat(8);
const asking = (headers: Record<string, string>) => new Headers(headers);

describe('requestUser', () => {
	it('takes the Authentik username when the proxy secret matches', () => {
		const headers = asking({ 'x-authentik-username': 'alice', 'x-proxy-secret': SECRET });
		expect(requestUser(headers, SECRET, 'demo')).toBe('alice');
	});

	it('ignores the username without the proxy secret: anonymous, not that user', () => {
		const headers = asking({ 'x-authentik-username': 'alice' });
		expect(requestUser(headers, SECRET, 'demo')).toBeNull();
		expect(requestUser(headers, SECRET, 'full')).toBe(LOCAL_USER);
	});

	it('ignores the username with a wrong proxy secret, also one of a different length', () => {
		for (const wrong of [SECRET.replace(/f/g, 'e'), SECRET.slice(1), '']) {
			const headers = asking({ 'x-authentik-username': 'alice', 'x-proxy-secret': wrong });
			expect(requestUser(headers, SECRET, 'demo')).toBeNull();
		}
	});

	it('believes the username as before when no PROXY_SECRET is configured', () => {
		const headers = asking({ 'x-authentik-username': 'alice' });
		expect(requestUser(headers, undefined, 'demo')).toBe('alice');
	});

	it('falls back to ANONYMOUS_ACCESS when nobody is signed in', () => {
		const headers = asking({ 'x-proxy-secret': SECRET });
		expect(requestUser(headers, SECRET, 'demo')).toBeNull();
		expect(requestUser(headers, SECRET, 'full')).toBe(LOCAL_USER);
	});
});
