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
}

/**
 * A day's feeder rides for one walk, per route end. Null: no direct ride known (no bus, or the end is
 * walkable); empty: none that day.
 */
export interface Feeders {
	start: FeederRide[] | null;
	end: FeederRide[] | null;
}
