#!/bin/sh
# Weekly refresh, run from cron on the server (see README): Wandelnet's pages downloaded afresh, the
# OpenStreetMap extract when it is older than six days, then the timetable step so the feeder buses
# follow the walks' new ends. ns.nl pages stay cached; new walks still get theirs.
# Every step runs even when an earlier one fails (Wandelnet being down shouldn't hold back OSM);
# the exit status says whether any failed.
failed=""
step() {
	echo "== $* ($(date '+%Y-%m-%d %H:%M'))"
	npm run --silent "$@" || failed="$failed $1"
}
step ingest:stations
step ingest:wandelnet -- --refresh
step ingest:paden -- --refresh
step ingest:nsnl
step ingest:osm
step ingest:gtfs
echo "== done ($(date '+%Y-%m-%d %H:%M'))"
if [ -n "$failed" ]; then
	echo "Failed:$failed"
	exit 1
fi
