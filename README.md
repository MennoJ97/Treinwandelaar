# Treinwandelaar

Personal planner for walking day trips by train: NS-wandelingen on a map, coloured by travel time from your
home station, with for each walk the train out, the walk itself (distance, duration, paved %, ratings,
photos) and the trains back from the end station.

**Personal use only.** Walk data comes from Wandelnet and ns.nl, whose terms forbid republishing. Run it
locally or behind authentication; don't host it publicly.

## Setup

```bash
npm install
cp .env.example .env      # add NS_API_KEY for train times (free: apiportal.ns.nl, product "Ns-App")
npm run ingest            # stations → Wandelnet walks → ns.nl enrichment, into data/treinwandelaar.db
npm run dev
```

Without `NS_API_KEY`, stations come from OpenStreetMap and the app works without travel times or trains.

## Data pipeline

| Step               | Source                                                    | Gives                                                      |
| ------------------ | --------------------------------------------------------- | ---------------------------------------------------------- |
| `ingest:stations`  | NS Stations API, or OSM Overpass as fallback              | ~400 NL stations with NS codes                             |
| `ingest:gtfs`      | OVapi GTFS (gtfs.ovapi.nl/nl, ~250 MB, daily), rail only  | the timetable for offline travel times, two months ahead   |
| `ingest:wandelnet` | wandelnet.nl/ns-wandelingen, route pages, review tab, GPX | route line, distance, start/end, description, star ratings |
| `ingest:nsnl`      | ns.nl/dagje-uit/wandelen pages                            | photos, paved %, dogs policy                               |

Raw responses are cached in `data/raw` (re-download with `-- --refresh`), at most one request per second.
Route ends are matched to the nearest station within 1.5 km. Walks that end in a village without a station
fall back to the nearest one within 12 km and are flagged as needing a bus. Fix mismatches in
`scripts/ingest/overrides.json`.

Travel times on the map come from that timetable (a connection-scan planner, a few ms per home
station), and NS's disruptions API flags walks whose route runs along works or a disruption on the
chosen day. The NS trip planner is only used for the exact trains in a walk's detail panel.

## Deploy

```bash
docker compose up -d --build
docker compose run --rm ingest   # first fill, then e.g. weekly from cron
```

Set `ORIGIN` and the Traefik labels in `docker-compose.yml` to match your setup, with an auth middleware in front.

"Wil ik lopen", "Gelopen", your rating and notes are stored per user, taken from the `X-authentik-username`
header that Authentik's forward-auth sets (list it in the middleware's `authResponseHeaders`). Traefik
replaces any copy of that header a client sends, so don't publish the app's port past Traefik. Without the
header, all visitors share the user `local`. That is also where ratings from before per-user storage end up;
to claim them, run `update user_walk set username = '<you>' where username = 'local'`.

## Data and licences

The code is MIT-licensed (see `LICENSE`). That covers the code only, not the data it fetches, and this
repository contains none of it: the test fixtures are hand-written in the shape of the real pages.

| Data                               | Owner                                              | Terms                                                                                                                                                                                |
| ---------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Walks: routes, GPX, texts, ratings | [Wandelnet](https://www.wandelnet.nl)              | Copyright and database right; [terms](https://www.wandelnet.nl/algemene-voorwaarden) art. 9.3 allow strictly own use only                                                            |
| Photos, paved %, dogs policy       | [NS](https://www.ns.nl)                            | Copyright of NS ([disclaimer](https://www.ns.nl/disclaimer)); not licensed for reuse                                                                                                 |
| Stations, disruptions, trips       | [NS API](https://apiportal.ns.nl)                  | Your own key, under the [API conditions](https://apiportal.ns.nl/voorwaarden): only to inform travellers about future journeys, no NS logo, don't suggest NS checked the information |
| Rail timetable (GTFS)              | [OVapi](https://gtfs.ovapi.nl) / Stichting OpenGeo | Free to use; don't claim to represent the transport operators                                                                                                                        |
| Base map                           | [OpenFreeMap](https://openfreemap.org)             | © OpenMapTiles, © OpenStreetMap contributors (shown on the map)                                                                                                                      |
| Stations without an NS key         | OpenStreetMap via Overpass                         | [ODbL](https://www.openstreetmap.org/copyright), © OpenStreetMap contributors                                                                                                        |

So: run your own copy for yourself, behind authentication, and don't publish the database, GPX files or photos.

## Layout

- `src/lib/server/ns.ts`: NS API client with a SQLite response cache (5 min for live trips, 7 days for the travel-time map)
- `src/lib/itinerary.ts`: walk-time estimate, Amsterdam time handling, travel-time bands
- `src/lib/components/WalkDetail.svelte`: the out → walk → back journey planner
- `scripts/lib/*.ts`: HTML/GPX parsers, tested against saved pages in `scripts/lib/__fixtures__`
