# Notes for coding agents

Only walks built from OpenStreetMap (`source = 'osm'`) may reach anonymous visitors: the map, the
walk pages under `/route/`, `/sitemap.xml` and `/api/`. The Wandelnet and ns.nl data is for personal
use (see `visibleTo` in `src/lib/server/walks.ts`).

`walks.changed_on` is the sitemap's `<lastmod>`: `saveWalk` (scripts/lib/store.ts) moves it only when
a column the walk's page shows changes, so an ingest that changes nothing leaves it alone. A new
column shown on the page belongs in `CONTENT_COLUMNS` there.
