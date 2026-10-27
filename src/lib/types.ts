export interface Station {
	code: string;
	uic: string | null;
	name: string;
	lat: number;
	lng: number;
}

export interface WalkPhoto {
	url: string;
	caption: string | null;
	source: string;
}

export type Collection = 'ns-wandeling' | 'ov-stapper' | 'streekpad' | 'law' | 'lokaal';

/** Where a walk's data comes from; only 'osm' (ODbL) may be shown publicly. */
export type WalkSource = 'wandelnet' | 'osm';

export const COLLECTION_LABELS: Record<Collection, string> = {
	'ns-wandeling': 'NS-wandeling',
	'ov-stapper': 'OV-stapper',
	streekpad: 'Streekpad',
	law: 'LAW-route',
	lokaal: 'Lokale route'
};

export interface WalkSummary {
	id: string;
	name: string;
	source: WalkSource;
	collection: Collection;
	startStation: string | null;
	endStation: string | null;
	startStationName: string | null;
	endStationName: string | null;
	startPlace: string | null;
	endPlace: string | null;
	/** Metres (straight line) between route start/end and the station; above 2000 a bus leg is needed. */
	startStationM: number | null;
	endStationM: number | null;
	isLoop: boolean;
	distanceKm: number;
	pavedPct: number | null;
	ratingAvg: number | null;
	reviewCount: number;
	thumbnail: string | null;
	status: 'wishlist' | 'done' | null;
	ownRating: number | null;
	/** Simplified route line, [lng, lat] pairs. */
	geometry: [number, number][];
}

export type Cover = 'forest' | 'heath' | 'dunes' | 'builtUp';

/**
 * What a walk passes, from OpenStreetMap (scripts/lib/context.ts), for its own page. Null for the
 * walks that don't come from OSM, and until the OSM ingest has run.
 */
export interface WalkAlong {
	/** Towns, villages and hamlets it passes, in walking order. */
	places: string[];
	/** Named nature reserves, national parks and estates it runs through, in walking order. */
	nature: string[];
	/** Named sights within ~150 m: "molen De Hoop", "Kasteel Doorwerth"… */
	sights: string[];
	/** Percent of the route (rounded to 10) through forest, heath, dunes and built-up area. */
	cover: Partial<Record<Cover, number>>;
	/** Percent of the route (rounded to 10) on ways OSM knows as paved or unpaved. */
	surface: { paved: number; unpaved: number };
}

/** Enough of a walk to link to it as the stage before or after another. */
export type StageSummary = Pick<
	WalkListItem,
	'id' | 'name' | 'startStationName' | 'endStationName' | 'startPlace' | 'endPlace' | 'distanceKm'
>;

/** A walk in the list, without its line: the page loads the lines on their own (/api/walk-lines). */
export type WalkListItem = Omit<WalkSummary, 'geometry'>;

/** A whole LAW route or streekpad, to plan your own stretches of it from station to station. */
export interface PathSummary {
	/** 'pad:<slug>' or 'osm:<slug>'; a stretch of it is the walk '<id>:<from code>-<to code>'. */
	id: string;
	name: string;
	source: WalkSource;
	collection: Collection;
	km: number;
}

/**
 * Where a day on the path can start or end: a station it passes within walking distance, or a stage's
 * end in a village a bus runs to from a station (found in the timetable by scripts/ingest/gtfs.ts).
 */
export interface PathStop {
	/** What a stretch id calls it: the station code, or 'e3' / 's1' for the end / start of stage 3 / 1. */
	key: string;
	/** The station: walked to, or where the bus goes. */
	code: string;
	name: string;
	/** The village, for a stage end reached by bus; null for a station stop. */
	place: string | null;
	/** Which of the path's lines (it can break at a ferry or a missing stage) and the point on it. */
	line: number;
	index: number;
	/** Along the path, from the start of its line. */
	km: number;
	/** Straight line from that point to the station: walked, or (from a village) a bus ride. */
	metres: number;
}

/** One of the path's own numbered stages ("etappes"), as a stretch of one of its lines. */
export interface PathStage {
	number: number;
	/** "Pieterburen – Winsum", where the source names the ends. */
	places: string | null;
	line: number;
	fromKm: number;
	toKm: number;
	/** Points on the line where it starts and ends. */
	fromIndex: number;
	toIndex: number;
	url: string;
}

export interface PathDetail extends PathSummary {
	/** Simplified lines, [lng, lat] pairs, usually one. */
	lines: [number, number][][];
	stops: PathStop[];
	stages: PathStage[];
	sourceUrl: string;
}

export interface WalkDetail extends WalkSummary {
	description: string | null;
	accessibility: string | null;
	features: string[];
	dogs: string | null;
	sourceUrl: string;
	nsUrl: string | null;
	gpxUrl: string | null;
	photos: WalkPhoto[];
	notes: string | null;
	along: WalkAlong | null;
	/** The stages of its path just before and after it, for the map's walk panel (withStages). */
	stages?: { prev: StageSummary | null; next: StageSummary | null };
}

export interface TripLeg {
	from: string;
	to: string;
	departure: string;
	arrival: string;
	plannedDeparture: string;
	track: string | null;
	product: string;
	/** Short category for compact display: "IC", "SPR", "ICD", "BUS"… */
	category: string;
	/** Replacement or regular bus rather than a train. */
	isBus: boolean;
	direction: string | null;
	cancelled: boolean;
	/** Where it runs, [lng, lat] pairs: along the tracks for a train; empty when NS gives no stops. */
	line: [number, number][];
}

/** A day out you saved: which walk, which way round, and the plan to open it with. */
export interface SavedTrip {
	walkId: string;
	walkName: string;
	reversed: boolean;
	date: string;
	time: string;
	out: string | null;
	back: string | null;
}

/** Where you are, from the phone's location while you follow yourself on an open walk. */
export interface Here {
	lng: number;
	lat: number;
	/** Metres either way the phone is unsure about. */
	accuracyM: number;
	/** When the phone took the fix, ms since 1970. */
	time: number;
}

export interface TripOption {
	departure: string;
	arrival: string;
	plannedDurationMin: number;
	actualDurationMin: number | null;
	transfers: number;
	status: string;
	crowdForecast: string | null;
	shareUrl: string | null;
	legs: TripLeg[];
}

/** Fastest planned trip from the home station, per destination station code. */
export type Reachability = Record<
	string,
	{
		minutes: number;
		transfers: number;
		/** Ids of disruptions/works on this route that day. */
		disruptions?: string[];
	} | null
>;

export interface Disruption {
	id: string;
	type: 'werkzaamheden' | 'storing';
	title: string;
	period: string | null;
	/** Compact period for the collapsed title: "16–18 okt", "t/m 14 jul 2027". */
	periodShort: string | null;
	situation: string | null;
	advices: string[];
}

export interface ReachabilityResponse {
	date: string;
	source: 'timetable' | 'ns';
	/** Out: fastest trip from home to each station, leaving 08:00–10:00. */
	times: Reachability;
	/** Back: fastest trip from each station home, arriving 15:00–20:00. Planned, not mirrored. */
	back: Reachability;
	disruptions: Record<string, Disruption>;
	/** Stations with no trains that day, and the works that close them. */
	closed?: Record<string, string[]>;
	incomplete: boolean;
}

/**
 * Route ends further than this (straight line) from their station need a bus/taxi leg; closer ones are
 * walked, about 2.5 km on the ground.
 */
export const WALKABLE_STATION_M = 2000;

/** Route ends closer than this to the station count as starting at it: no separate walk to show. */
export const AT_STATION_M = 300;

/** A bus (tram, metro, ferry) between the station and a route end too far to walk. */
export interface FeederRide {
	/** "Bus 136", "Metro B". */
	line: string;
	operator: string | null;
	headsign: string | null;
	/** Stop names. */
	from: string;
	to: string;
	departure: string;
	arrival: string;
	/** Straight-line metres between the stop and the route end. */
	stopM: number;
	/** Where it runs from `from` to `to`, [lng, lat] pairs along its streets; empty when unknown. */
	geometry: [number, number][];
}

/**
 * A day's feeder rides for one walk, per route end. Null: no direct ride known (no bus, or the end is
 * walkable); empty: none that day.
 */
export interface Feeders {
	start: FeederRide[] | null;
	end: FeederRide[] | null;
}
