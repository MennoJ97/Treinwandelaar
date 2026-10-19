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
npm run ingest            # stations → walks → ns.nl enrichment → timetable, into data/treinwandelaar.db
npm run dev
```

Without `NS_API_KEY`, stations come from OpenStreetMap and the app works without travel times or trains.

## Data pipeline

| Step               | Source                                                    | Gives                                                         |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------- |
| `ingest:stations`  | NS Stations API, or OSM Overpass as fallback              | ~400 NL stations with NS codes                                |
| `ingest:gtfs`      | OVapi GTFS (gtfs.ovapi.nl/nl, ~250 MB, daily)             | rail timetable two months ahead, plus buses to far route ends |
| `ingest:wandelnet` | wandelnet.nl/ns-wandelingen, route pages, review tab, GPX | route line, distance, start/end, description, star ratings    |
| `ingest:nsnl`      | ns.nl/dagje-uit/wandelen pages                            | photos, paved %, dogs policy                                  |
| `ingest:osm`       | Geofabrik's OSM extract of NL (~1.4 GB, weekly), osmium   | LAW, streekpad and local walks from OpenStreetMap             |

Raw responses are cached in `data/raw` (re-download with `-- --refresh`), at most one request per second.
`ingest:osm` needs [osmium](https://osmcode.org/osmium-tool/) (`brew install osmium-tool`, or
`apt install osmium-tool`; the Docker image has it) and keeps the extract in `data/osm`.
Route ends are matched to the nearest station within 2 km; the planner shows that stretch as a walk (straight
line plus 30%). Walks that end in a village without a station fall back to the nearest one within 12 km and
need a bus: `ingest:gtfs` then also keeps the buses, trams and metros that run between stops near that route
end and near the station, so the planner can pick a real departure (it falls back to an estimate where there
is no direct line). That depends on the walks, so `npm run ingest` runs it last. For an end with no direct
line to its station it logs the stations a line from there does reach, by typical ride: point the walk at
one of those, and fix other mismatches, in `scripts/ingest/overrides.json`.

LAW routes and streekpaden are cut into a few day walks between stations the path passes within 1.5 km,
and also kept whole, with every station within 2 km. Pick one under "Route" in the filters to plan your own
stretches on it, e.g. Pieterpad stages: every station along it with its km, stage and travel time, and any
two of them make a walk (`<path>:<from>-<to>`, either direction) that's planned when you open it. Stage ends
more than 3 km along the path from a station are stops too when a bus serves them both ways (most days):
`ingest:gtfs` looks up which station the buses from there reach and keeps the rides, so you can plan
through the Drenthe stretch of the Pieterpad from Zuidlaren or Rolde (`<path>:e3-…`, the end of the
fourth stage). Mark a stretch "Wil ik lopen" or "Gelopen" and it's kept as a walk of its own.

Travel times on the map come from that timetable (a connection-scan planner, a few ms per home
station), and NS's disruptions API flags walks whose route runs along works or a disruption on the
chosen day. The NS trip planner is only used for the exact trains in a walk's detail panel.

## Deploy

```bash
docker compose up -d --build
docker compose run --rm ingest   # first fill
```

The timetable needs nothing more: run `ingest:gtfs` daily (it only downloads when OVapi has a newer feed). For the
walks, `npm run ingest:weekly` is light: it downloads only the overview pages afresh (`--refresh-lists`), so new
walks come in and delisted ones go while known walks' pages stay cached. On the first Monday of each quarter, or with
`-- --full`, it downloads every Wandelnet page again (`--refresh`) to pick up edited routes; a page that fails to
download then keeps its cached copy, so a hiccup doesn't delist a walk. Wandelnet's terms allow copying only for your
own use, and database law frowns on repeated wholesale extraction, hence the light default. It also refreshes the OSM
extract and rebuilds the feeder buses. From cron, e.g. Mondays at 04:00 (`ingest` has a compose profile, so
`up --build` doesn't rebuild it):

```cron
0 4 * * 1 cd /path/to/stack && { docker compose --profile ingest build -q ingest && docker compose run -T --rm ingest npm run ingest:weekly; } > /path/to/data/ingest-weekly.log 2>&1
```

Set `ORIGIN` and the Traefik labels in `docker-compose.yml` to match your setup, with an auth middleware in front. `FAMILY_SITE`
(optional, see `.env.example`) points the page at a parent site's shared stylesheet, script and link-preview image;
domains and keys belong in `.env`, never in the repository.

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

Each walk can also be downloaded as GPX (`/api/walks/<id>/gpx`), with the same visibility as the walk
itself. The file carries its own credit, since it travels on without the site: © OpenStreetMap
contributors and the ODbL for OSM walks (plus Wandelnet for LAW routes and streekpaden), and
"© Stichting Wandelnet, alleen voor eigen gebruik" for Wandelnet's walks, which only signed-in users get.
Where Wandelnet offers its own GPX (NS-wandelingen, OV-stappers), the app links to that instead.

## Layout

- `src/lib/server/ns.ts`: NS API client with a SQLite response cache (5 min for live trips, 7 days for the travel-time map)
- `src/lib/itinerary.ts`: walk-time estimate, Amsterdam time handling, travel-time bands
- `src/lib/components/WalkDetail.svelte`: the out → walk → back journey planner
- `scripts/lib/*.ts`: HTML/GPX parsers, tested against saved pages in `scripts/lib/__fixtures__`
