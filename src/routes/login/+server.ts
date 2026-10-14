import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * The one path Authentik doesn't let through anonymously: reaching it means the visitor signed in,
 * so send them back to the map, which now shows everything.
 */
export const GET: RequestHandler = () => redirect(303, '/');
