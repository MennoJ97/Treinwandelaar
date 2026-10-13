# Ideas and open threads

Things considered but not built yet, with what we learned. Roughly in order of value.

## Train and bus planning

- **Real bus departures for bus-leg walks.** Today a bus leg (e.g. Belmonte ends in Wageningen, 6.5 km
  from Ede-Wageningen) is an estimate: 10 min + 3 min/km. OVapi publishes the full Dutch timetable as
  GTFS for free (`gtfs.ovapi.nl/nl/gtfs-nl.zip`, ~250 MB, daily). The question per walk is narrow: which
  trips serve a stop near the route end and then a stop near the station, after time T. No full router needed.
  Optionally add GTFS-RT for delays.
- **Not using 9292.** Their Reisadvies API is paid (older reports: €200–2,000/yr), needs approval and
  their logo. Unofficial reverse-engineered APIs break their terms. A cheap alternative is a deep link
  to the 9292 planner with the bus leg pre-filled.
- **NS door-to-door is not available on the free key.** `/api/v3/trips` with `originLat`/`originLng`
  returns "Met deze API key mogen geen deur-tot-deur adviezen opgevraagd worden".
- **Safety margin before the first return train.** The walk end is an estimate, yet the first option can
  leave 4 minutes after it (Beesd: ±12:56 → 13:00). Consider hiding or de-emphasising trains < 10 min after.
- **Other APIs in the Ns-App product** (same key): Disruptions (warn about works on the way out/back),
  SpoorKaart (draw the actual rail line from home to the start), Virtual Train (train length, quiet carriages).
- **Done (2026-10-13): offline travel times.** The map now plans over the OVapi GTFS rail timetable
  (`scripts/ingest/gtfs.ts`, `src/lib/server/railRouter.ts`) and checks NS disruptions per route; the NS
  trip API is only used for the exact trains in the detail planner. Open: the return trip is checked as
  the reverse of the outbound route, and transfer time is a flat 3 minutes (NS uses per-station times;
  GTFS `transfers.txt` has them).

## More walks

- **Check bus-leg stations for OV-stappers.** The nearest-station fallback can pick a station across a river
  (it chose Opheusden for Wageningen). Fixed for the NS walks via `scripts/ingest/overrides.json` using the
  directions on ns.nl; still unchecked: Amsterdamse Bos, Boonervliet, Elburg, Geuldal, Hondsrug,
  Loonse en Drunense Duinen, Muiderslot, Omringdijk, Paaschberg, Tongelreep.
- **Side routes on streekpad pages** ("Rondwandeling Beesd", "Struinroute Heerewaarden-Tiel") are listed
  next to the numbered stages. Ingest them as standalone walks when they start near a station.
- **Trage Tochten and Klompenpaden** used to be on Wandelnet; `/trage-tochten` and `/klompenpaden` now 404.
  Find where they live now (maybe via `/wandelroute-zoeken`).
- **Sparse streekpaden/LAW stretches.** Sections need a station within 1.5 km of the path at both ends
  and 8–26 km between them. Some paths give nothing or little: Drenthepad, Twentepad (Almelo → Oldenzaal
  is 72 km), Pionierspad (skirts Lelystad/Almere), Grenslandpad, Noaberpad, Dwars door Brabant (misses
  Etten-Leur station by just over 1.5 km), Kustpad deel 1, WaddenWandelen. Options: a longer approach
  walk (counted in the distance), or bus legs to village ends like the NS walks have.
- **Retired paths:** Streekpad Rijk van Nijmegen's stage pages and GPX are gone (404).
- **Other curated sources**, all personal-use only: Routes in Utrecht (Plaece/Ubase; GPX at
  `api.ubase.nl/route/download/{id}/gpx`), Natuurmonumenten and Staatsbosbeheer (GPX per route).
  Many are loops from a car park, so few will start near a station.
- **OpenStreetMap hiking relations** (`route=hiking`, `network=nwn|rwn|lwn`, via Overpass) as an open
  (ODbL) source, cut into station sections with the same code as the streekpaden (`scripts/lib/sections.ts`).
  Relation members can be unordered, so they need stitching.
- **Komoot** is out: partner-only API, terms forbid export.

## Performance

- **The page embeds every route line.** With 218 walks the HTML is ~840 KB, mostly geometry in the page
  data. Serve geometry as a separate, cacheable GeoJSON endpoint (or vector tiles) and keep the page data
  to the list fields.

## Judging how nice a walk is

- **A computed scenic score**, comparable across sources, from OSM data along the route:
  share through forest/heath/dunes/water/nature reserves vs built-up land, share unpaved (`highway=path|track`,
  `surface=*`), metres along busy roads (negative), viewpoints/castles/windmills nearby, and Wikimedia Commons
  photos near the route. Blend with Wandelnet star ratings where they exist.
- **GPX for cut sections.** Streekpad/LAW day walks are cut from joined stages and have no GPX link.
  Generate one from the stored geometry (keep an unsimplified copy for this).
