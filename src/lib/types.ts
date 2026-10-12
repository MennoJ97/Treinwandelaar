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

export interface WalkSummary {
	id: string;
	name: string;
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
export type Reachability = Record<string, { minutes: number; transfers: number } | null>;

/** Walks further than this from a station need a bus/taxi leg. */
export const WALKABLE_STATION_M = 1500;
