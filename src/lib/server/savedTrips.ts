import type { DatabaseSync } from 'node:sqlite';
import type { TripPlan } from '../plan';
import type { SavedTrip } from '../types';
import { visibleTo } from './walks';

/** Your saved days out, soonest first; only walks you can still see. */
export function listSavedTrips(db: DatabaseSync, user: string): SavedTrip[] {
	const rows = db
		.prepare(
			`select t.walk_id, w.name, t.reversed, t.date, t.time, t.out_train, t.back_train
			 from user_trip t join walks w on w.id = t.walk_id
			 where t.username = ? and ${visibleTo(user)}
			 order by t.date, coalesce(t.out_train, t.time)`
		)
		.all(user) as {
		walk_id: string;
		name: string;
		reversed: number;
		date: string;
		time: string;
		out_train: string | null;
		back_train: string | null;
	}[];
	return rows.map((r) => ({
		walkId: r.walk_id,
		walkName: r.name,
		reversed: !!r.reversed,
		date: r.date,
		time: r.time,
		out: r.out_train,
		back: r.back_train
	}));
}

/** One trip per walk and date: saving it again replaces the plan. */
export function saveTrip(
	db: DatabaseSync,
	user: string,
	walkId: string,
	reversed: boolean,
	plan: TripPlan
) {
	db.prepare(
		`insert into user_trip (username, walk_id, date, reversed, time, out_train, back_train)
		 values (?, ?, ?, ?, ?, ?, ?)
		 on conflict(username, walk_id, date) do update set reversed = excluded.reversed,
			time = excluded.time, out_train = excluded.out_train, back_train = excluded.back_train,
			saved_at = datetime('now')`
	).run(user, walkId, plan.date, reversed ? 1 : 0, plan.time, plan.out, plan.back);
}

export function deleteSavedTrip(db: DatabaseSync, user: string, walkId: string, date: string) {
	db.prepare('delete from user_trip where username = ? and walk_id = ? and date = ?').run(
		user,
		walkId,
		date
	);
}
