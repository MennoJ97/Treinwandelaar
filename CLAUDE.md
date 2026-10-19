# Notes for coding agents

## Open: per-walk pages and a sitemap with `<lastmod>` (handoff, 2026-10-19)

The site has no sitemap yet: every walk lives at `/?route=…` with the same
title and canonical, so search engines see one page. When walks get their own
URLs (`/route/<id>`, prerendered title/description/h1), add `/sitemap.xml` as
a SvelteKit endpoint generated from the database, not a hand-written file, and
give each URL a `<lastmod>`: the date that walk's data last changed in an
ingest (store it if the schema does not have it yet). An ingest that changes
nothing must not bump it, or Google learns to ignore lastmod for the site.
W3C date (`YYYY-MM-DD`); leave the tag out rather than guess.

Only list walks an anonymous visitor may see (`source = 'osm'`, see
`src/lib/server/paths.ts`): the Wandelnet and ns.nl data is for personal use.
The deployment's Authentik provider already lets `/route/` and `/sitemap.xml`
through without a login.
