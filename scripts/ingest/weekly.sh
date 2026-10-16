#!/bin/sh
# Weekly refresh, run from cron on the server (see README). Light by default: only the overview pages
# (which walks exist) are downloaded afresh, so new walks come in and delisted ones go, while known
# walks' pages stay cached. Once a quarter (the first Monday of January, April, July and October), or
# with --full, every Wandelnet page is downloaded again to pick up edited routes. Then the OSM extract
# when it is older than six days, and the timetable step so the feeder buses follow the walks' ends.
# Every step runs even when an earlier one fails (Wandelnet being down shouldn't hold back OSM);
# the exit status says whether any failed.
mode=--refresh-lists
case "$(date +%m)" in
01 | 04 | 07 | 10) [ "$(date +%d)" -le 7 ] && mode=--refresh ;;
esac
[ "$1" = --full ] && mode=--refresh
echo "Wandelnet: $mode"

failed=""
step() {
	echo "== $* ($(date '+%Y-%m-%d %H:%M'))"
	npm run --silent "$@" || failed="$failed $1"
}
step ingest:stations
step ingest:wandelnet -- $mode
step ingest:paden -- $mode
step ingest:nsnl -- --refresh-lists
step ingest:osm
step ingest:gtfs
echo "== done ($(date '+%Y-%m-%d %H:%M'))"
if [ -n "$failed" ]; then
	echo "Failed:$failed"
	exit 1
fi
