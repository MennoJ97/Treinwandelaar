/**
 * Draw the link-preview cards of the OSM walks again where they changed (see ../lib/cards.ts). The
 * OSM ingest does this itself; this is for after a change to the cards' design.
 */
import { openDb } from '../../src/lib/server/db';
import { cardHost, CARD_DIR, renderCards } from '../lib/cards';

const started = Date.now();
const { walks, drawn, deleted } = await renderCards(openDb(), CARD_DIR, cardHost());
console.log(
	`${drawn} of ${walks} cards drawn, ${deleted} deleted, in ${((Date.now() - started) / 1000).toFixed(0)} s.`
);
