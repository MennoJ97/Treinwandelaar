import { DATABASE_PATH, HOME_STATION, NS_API_KEY } from '$app/env/private';
import { openDb } from './db';
import { NsClient } from './ns';

export const db = () => openDb(DATABASE_PATH);

export const homeStation = () => HOME_STATION;

/** NS client, or null when no API key is configured (the UI then shows walks without train times). */
export function ns(): NsClient | null {
	return NS_API_KEY ? new NsClient(NS_API_KEY, db()) : null;
}
