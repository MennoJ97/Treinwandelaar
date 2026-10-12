import { WALKABLE_STATION_M, type WalkSummary } from './types';

const needsBusAt = (metres: number | null) => (metres ?? 0) > WALKABLE_STATION_M;

export const needsBus = (w: WalkSummary) =>
	needsBusAt(w.startStationM) || needsBusAt(w.endStationM);

/** Where the walk itself starts: the station, or the village when a bus is needed to get there. */
export const startLabel = (w: WalkSummary) =>
	(needsBusAt(w.startStationM) ? w.startPlace : w.startStationName) ?? w.startPlace ?? '?';

export const endLabel = (w: WalkSummary) =>
	(needsBusAt(w.endStationM) ? w.endPlace : w.endStationName) ?? w.endPlace ?? '?';
