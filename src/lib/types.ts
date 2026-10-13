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

export type Collection = 'ns-wandeling' | 'ov-stapper' | 'streekpad' | 'law';

export const COLLECTION_LABELS: Record<Collection, string> = {
	'ns-wandeling': 'NS-wandeling',
	'ov-stapper': 'OV-stapper',
	streekpad: 'Streekpad',
	law: 'LAW-route'
};

export interface WalkSummary {
	id: string;
	name: string;
	collection: Collection;
	startStation: string | null;
	endStation: string | null;
	startStationName: string | null;
	endStationName: string | null;
	startPlace: string | null;
	endPlace: string | null;
	/** Metres between route start/end and the station; above ~1500 a bus leg is needed. */
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

/** Walks further than this from a station need a bus/taxi leg. */
export const WALKABLE_STATION_M = 1500;
