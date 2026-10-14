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
| `ingest:osm`       | Geofabrik's OSM extract of NL (~1.4 GB, weekly), osmium   | LAW, streekpad and local walks from OpenStreetMap          |

Raw responses are cached in `data/raw` (re-download with `-- --refresh`), at most one request per second.
`ingest:osm` needs [osmium](https://osmcode.org/osmium-tool/) (`brew install osmium-tool`, or
`apt install osmium-tool`; the Docker image has it) and keeps the extract in `data/osm`.
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
replaces any copy of that header a client sends, so don't publish the app's port past Traefik.

Without the header, `ANONYMOUS_ACCESS` decides. `demo`, the default, shows only the OpenStreetMap walks and
saves nothing; `full` shows everything to everyone as the shared user `local`, for local or LAN-only use
(`.env.example` sets it). Ratings from before per-user storage belong to `local`; to claim them, run
`update user_walk set username = '<you>' where username = 'local'`.

### Public demo with Authentik

Authentik can let anonymous visitors through while still sending `X-authentik-username` for signed-in ones:
the outpost checks the session first and only then the provider's **Unauthenticated Paths**. With a
single-application forward-auth provider (paths are matched without the host), list everything except
`/login`:

```
^/$
^/\?
^/__data\.json
^/_app/
^/api/
^/robots\.txt$
```

Visitors then get the demo, and the "Inloggen" link (`/login`) sends them through Authentik and back.
Deploy the app and run `npm run ingest:osm` before you add the paths, and keep `ANONYMOUS_ACCESS` unset
or `demo`; with `full`, anonymous visitors would see everything.

## Data and licences

The code is MIT-licensed (see `LICENSE`). That covers the code only, not the data it fetches, and this
repository contains none of it: the test fixtures are hand-written in the shape of the real pages.

| Data                               | Owner                                                                                | Terms                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Walks: routes, GPX, texts, ratings | [Wandelnet](https://www.wandelnet.nl)                                                | Copyright and database right; [terms](https://www.wandelnet.nl/algemene-voorwaarden) art. 9.3 allow strictly own use only                                                            |
| Photos, paved %, dogs policy       | [NS](https://www.ns.nl)                                                              | Copyright of NS ([disclaimer](https://www.ns.nl/disclaimer)); not licensed for reuse                                                                                                 |
| Stations, disruptions, trips       | [NS API](https://apiportal.ns.nl)                                                    | Your own key, under the [API conditions](https://apiportal.ns.nl/voorwaarden): only to inform travellers about future journeys, no NS logo, don't suggest NS checked the information |
| Rail timetable (GTFS)              | [OVapi](https://gtfs.ovapi.nl) / Stichting OpenGeo                                   | Free to use; don't claim to represent the transport operators                                                                                                                        |
| Base map                           | [OpenFreeMap](https://openfreemap.org)                                               | © OpenMapTiles, © OpenStreetMap contributors (shown on the map)                                                                                                                      |
| Stations without an NS key         | OpenStreetMap via Overpass                                                           | [ODbL](https://www.openstreetmap.org/copyright), © OpenStreetMap contributors                                                                                                        |
| Demo walks: LAW, streekpad, local  | OpenStreetMap via [Geofabrik](https://download.geofabrik.de/europe/netherlands.html) | [ODbL](https://www.openstreetmap.org/copyright), © OpenStreetMap contributors; see below for why these routes may be in OSM at all                                                   |

So: run your own copy for yourself, behind authentication, and don't publish the database, GPX files or photos.

### The public demo

With `ANONYMOUS_ACCESS=demo`, visitors who aren't signed in see only walks built from OpenStreetMap
(`npm run ingest:osm`), never the Wandelnet or ns.nl data above. Signed-in users see the OSM walks too,
except the ones that run over the same ground as a Wandelnet walk (70% of the route within 75 m). Wandelnet's terms cover what you take from
wandelnet.nl; OSM is a separate database, drawn by its contributors and published under the ODbL, which
allows public reuse with attribution. Whether a route may be in OSM in the first place differs per kind:

- **LAW routes and streekpaden**: Wandelnet's LAW coordinator wrote on the OSM forum (14 May 2019) that
  "het intekenen van LAW's en Streekpaden OK is", asking that Wandelnet be named as the source and that the
  white-red and yellow-red marks, protected trademarks, aren't used
  ([thread, post 14](https://community.openstreetmap.org/t/wandelroutes-law-sp-en-ns-samenwerking-met-wandelnet/86827/14)).
  The demo credits Wandelnet and shows no marks.
- **NS-wandelingen**: in the same thread Wandelnet refused permission
  ([post 1](https://community.openstreetmap.org/t/wandelroutes-law-sp-en-ns-samenwerking-met-wandelnet/86827/1)).
  Some are still in OSM; the ingest skips every route whose name or operator mentions NS.
- **Local walks** (klompenpaden, ommetjes, nature-area routes): OSM maps routes that are marked in the field
  ([WikiProject Nederland Wandelroutes](https://wiki.openstreetmap.org/wiki/WikiProject_Nederland_Wandelroutes)),
  surveyed by contributors, and its [import guidelines](https://wiki.openstreetmap.org/wiki/Import/Guidelines)
  require permission for anything copied from a third party. The operator is shown with each walk.

The ODbL can't cure a route that someone copied into OSM without permission, as happened with the NS walks.
If you run a public demo, remove a route when its owner asks. The ODbL also asks you to offer the derived
data: the demo serves it at `/api/osm-walks.geojson`.

## Layout

- `src/lib/server/ns.ts`: NS API client with a SQLite response cache (5 min for live trips, 7 days for the travel-time map)
- `src/lib/itinerary.ts`: walk-time estimate, Amsterdam time handling, travel-time bands
- `src/lib/components/WalkDetail.svelte`: the out → walk → back journey planner
- `scripts/lib/*.ts`: HTML/GPX parsers, tested against saved pages in `scripts/lib/__fixtures__`
