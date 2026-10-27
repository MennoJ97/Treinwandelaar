<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import DayMap, { type Camera } from '#lib/components/DayMap.svelte';
	import { askCompass, watchCompass } from '#lib/compass.js';
	import { haversine, locateOnLine, type LngLat } from '#lib/geo.js';
	import {
		accessAt,
		accessMinutes,
		addMinutes,
		amsterdamIso,
		amsterdamYmd,
		busMinutes,
		DEFAULT_PACE,
		formatDuration,
		formatTime,
		minutesBetween,
		TRANSFER_MIN,
		walkMinutes
	} from '#lib/itinerary.js';
	import {
		bearing,
		closestStations,
		compassWord,
		paceKmh,
		pointAlong,
		startProgress,
		step,
		type Fix,
		type Progress
	} from '#lib/navigate.js';
	import { readPlan, writePlan } from '#lib/plan.js';
	import { track } from '#lib/track.js';
	import { delayMinutes, fetchTrips, onePerDeparture, readHome, readPace } from '#lib/trains.js';
	import type { FeederRide, Feeders, TripOption } from '#lib/types.js';
	import {
		endLabel,
		formatKm,
		osmCredit,
		reverseWalk,
		startLabel,
		walkHeading,
		wandelnetCredit
	} from '#lib/walk.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const reversed = $derived(page.url.searchParams.get('reverse') === '1');
	const walk = $derived(reversed ? reverseWalk(data.walk) : data.walk);
	const plan = $derived(readPlan(page.url.searchParams));
	const credit = $derived(
		data.walk.source === 'osm' ? osmCredit(data.updated) : wandelnetCredit(data.updated)
	);

	/** The clock, ticking: what's still to come changes as the day goes on. */
	let now = $state(Date.now());
	const today = $derived(amsterdamYmd(new Date(now)));
	const date = $derived(plan?.date ?? today);
	const isToday = $derived(date === today);
	const dayLabel = $derived(
		isToday
			? 'vandaag'
			: new Date(`${date}T12:00:00`).toLocaleDateString('nl-NL', {
					weekday: 'long',
					day: 'numeric',
					month: 'long'
				})
	);

	// What this browser knows about you; the server renders the defaults.
	let home = $state(untrack(() => data.defaultHome));
	let pace = $state(DEFAULT_PACE);
	const homeStation = $derived(data.stations.find((s) => s.code === home) ?? null);

	/** Back to the planner on the home page, with this walk and plan open. */
	const plannerHref = $derived.by(() => {
		const params = new URLSearchParams({ walk: data.walk.id });
		writePlan(params, plan);
		if (reversed) params.set('reverse', '1');
		return `/?${params}`;
	});

	// --- Following you ------------------------------------------------------------------------------
	let fix = $state.raw<Fix | null>(null);
	let progress = $state.raw<Progress>(untrack(() => startProgress(walk.geometry)));
	let following = $state(false);
	let locationProblem = $state<string | null>(null);
	let camera = $state<Camera>('free');
	let watchId: number | null = null;

	/** Your progress, kept for a reload or a phone that drops the page: this walk, this day. */
	const PROGRESS_KEY = 'treinwandelaar.progress';
	const progressKey = $derived(`${data.walk.id}|${reversed ? 'r' : ''}|${date}`);
	function saveProgress() {
		try {
			localStorage.setItem(PROGRESS_KEY, JSON.stringify({ key: progressKey, progress }));
		} catch {
			/* no storage: starts afresh after a reload */
		}
	}
	function restoreProgress() {
		try {
			const kept = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? 'null');
			const last = kept?.progress?.trail?.at(-1)?.time;
			if (
				kept?.key === progressKey &&
				typeof last === 'number' &&
				Date.now() - last < 12 * 3600_000
			)
				progress = kept.progress;
		} catch {
			/* nothing kept */
		}
	}

	function onFix(p: GeolocationPosition) {
		const next: Fix = {
			lng: p.coords.longitude,
			lat: p.coords.latitude,
			accuracyM: p.coords.accuracy,
			time: p.timestamp
		};
		const before = progress;
		progress = step(progress, next, walk.geometry);
		fix = next;
		locationProblem = null;
		// Walking, the phone knows which way you go; standing still, that's noise.
		if (p.coords.heading !== null && !Number.isNaN(p.coords.heading) && (p.coords.speed ?? 0) > 0.7)
			course = p.coords.heading;
		// A buzz in your pocket when it goes wrong (Android; an iPhone doesn't let a site do that).
		if ((progress.offRoute && !before.offRoute) || (progress.wrongWay && !before.wrongWay))
			navigator.vibrate?.([200, 100, 200]);
		saveProgress();
	}

	function onLocationError(e: GeolocationPositionError) {
		if (e.code === GeolocationPositionError.PERMISSION_DENIED) {
			stopFollowing();
			locationProblem =
				'Je browser geeft je locatie niet door. Geef deze site toestemming in de instellingen van je browser of telefoon.';
		} else
			locationProblem = 'Je locatie is even niet te bepalen; zodra die er is, gaat het verder.';
	}

	/** Start following you: from a tap, so iOS can ask for the compass too. */
	function startFollowing(asked = true) {
		if (watchId !== null) return;
		if (!('geolocation' in navigator)) {
			locationProblem = 'Deze browser kan je locatie niet bepalen.';
			return;
		}
		watchId = navigator.geolocation.watchPosition(onFix, onLocationError, {
			enableHighAccuracy: true,
			maximumAge: 5000,
			timeout: 30_000
		});
		following = true;
		camera = 'follow';
		keepAwake();
		if (asked) void enableCompass();
		else startCompass();
		track('day-follow', { id: data.walk.id });
	}

	function stopFollowing() {
		if (watchId !== null) navigator.geolocation.clearWatch(watchId);
		watchId = null;
		following = false;
		fix = null;
		camera = 'free';
		stopCompass?.();
		stopCompass = null;
		compassHeading = null;
		void wakeLock?.release().catch(() => {});
		wakeLock = null;
	}

	// --- Which way you face: the compass, else the way you walk --------------------------------------
	let compassHeading = $state<number | null>(null);
	let course = $state<number | null>(null);
	let stopCompass: (() => void) | null = null;
	const heading = $derived(compassHeading ?? course);

	function startCompass() {
		stopCompass ??= watchCompass((degrees) => (compassHeading = degrees));
	}

	/** The compass, asked for where that's needed; true once there's a way you face to turn to. */
	async function enableCompass(): Promise<boolean> {
		if (compassHeading !== null) return true;
		if (!(await askCompass())) return course !== null;
		startCompass();
		// A laptop has no compass: it just never says anything.
		for (let i = 0; i < 12 && compassHeading === null; i++)
			await new Promise((r) => setTimeout(r, 100));
		return compassHeading !== null || course !== null;
	}

	// --- The screen stays on while you follow yourself -----------------------------------------------
	let wakeLock: WakeLockSentinel | null = null;
	async function keepAwake() {
		try {
			wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
		} catch {
			/* not allowed (battery saver) or not there: the screen goes off as usual */
		}
	}

	onMount(() => {
		home = readHome(data.defaultHome);
		pace = readPace();
		restoreProgress();
		const tick = setInterval(() => (now = Date.now()), 30_000);
		// The lock goes when the page is hidden; back on screen it's asked for again.
		const onVisible = () => {
			if (document.visibilityState === 'visible' && following) keepAwake();
		};
		document.addEventListener('visibilitychange', onVisible);
		// Already allowed (a reload, or the day before): pick up at once on the day itself.
		navigator.permissions
			?.query({ name: 'geolocation' })
			.then((status) => {
				if (status.state === 'granted' && isToday) startFollowing(false);
			})
			.catch(() => {});
		return () => {
			clearInterval(tick);
			document.removeEventListener('visibilitychange', onVisible);
			stopFollowing();
		};
	});

	// --- Where you are on the walk -------------------------------------------------------------------
	/** Kilometres of the walk still ahead: the walk's own, which can differ a little from its line's. */
	const toGoKm = $derived(
		progress.started && progress.lengthM
			? Math.max(0, walk.distanceKm * (1 - progress.alongM / progress.lengthM))
			: walk.distanceKm
	);
	/** On your way to the route's start, as the crow flies. */
	const toStartM = $derived(
		fix && !progress.started ? haversine([fix.lng, fix.lat], walk.geometry[0]) : null
	);
	const measuredKmh = $derived(paceKmh(progress));
	const minutesLeft = $derived(
		(measuredKmh ? Math.round((toGoKm / measuredKmh) * 60) : walkMinutes(toGoKm, pace)) +
			(toStartM ? accessMinutes(toStartM, pace.speedKmh) : 0)
	);
	/** When you'll be at the route's end, at your pace. Only today, and only once we know where you are. */
	const endAt = $derived(
		fix && isToday ? new Date(Math.max(now, fix.time) + minutesLeft * 60_000).toISOString() : null
	);

	/** Off the route: the nearest spot on it, and which way that is. */
	const rejoin = $derived.by(() => {
		if (!fix || !progress.offRoute) return null;
		const here: LngLat = [fix.lng, fix.lat];
		const spot = locateOnLine(here, walk.geometry, progress.alongM);
		const at = pointAlong(walk.geometry, spot.alongM);
		return { at, metres: spot.offM, way: compassWord(bearing(here, at)) };
	});

	// --- The end of the route to the train home ------------------------------------------------------
	const endAccess = $derived(accessAt(walk.endStationM));
	const endsAtHome = $derived(walk.endStation === home);

	let feeders = $state.raw<Feeders | null>(null);
	$effect(() => {
		if (endAccess !== 'bus') return;
		const controller = new AbortController();
		const params = new URLSearchParams({ date, ...(reversed && { reverse: '1' }) });
		fetch(`/api/walks/${encodeURIComponent(data.walk.id)}/feeders?${params}`, {
			signal: controller.signal
		})
			.then((res) => (res.ok ? res.json() : null))
			.then((f) => (feeders = f))
			.catch(() => {});
		return () => controller.abort();
	});

	/** The bus from the route's end you'll make, at your pace. */
	const endRide = $derived.by((): FeederRide | null => {
		if (endAccess !== 'bus' || !endAt || !feeders?.end) return null;
		return (
			feeders.end.find(
				(r) =>
					new Date(r.departure) >=
					new Date(addMinutes(endAt, accessMinutes(r.stopM, pace.speedKmh)))
			) ?? null
		);
	});

	/** When you'll be on the platform for the train home. */
	const readyAt = $derived.by(() => {
		if (!endAt) return null;
		if (endAccess === 'walk')
			return addMinutes(endAt, accessMinutes(walk.endStationM!, pace.speedKmh));
		if (endAccess === 'bus')
			return endRide
				? addMinutes(endRide.arrival, TRANSFER_MIN)
				: addMinutes(endAt, busMinutes(walk.endStationM!));
		return endAt;
	});

	type Trains = { trips: TripOption[]; savedAt: number | null } | { error: string } | null;
	const floorTo = (iso: string, minutes: number) =>
		new Date(
			Math.floor(new Date(iso).getTime() / (minutes * 60_000)) * minutes * 60_000
		).toISOString();

	/** Every few minutes the trains again, for the delays: the server keeps NS's answer 5 minutes. */
	let refresh = $state(0);
	$effect(() => {
		if (!isToday) return;
		const t = setInterval(() => refresh++, 3 * 60_000);
		return () => clearInterval(t);
	});

	function loadTrains(from: string, to: string, at: string, set: (t: Trains) => void) {
		const controller = new AbortController();
		fetchTrips(from, to, at, controller.signal)
			.then(set)
			.catch((err) => {
				if (!controller.signal.aborted) set({ error: err.message });
			});
		return () => controller.abort();
	}

	// Home from the end: around when you'll be there, or the train you planned while that's unknown.
	const backFrom = $derived(
		readyAt ? floorTo(readyAt, 10) : plan?.back ? amsterdamIso(date, plan.back) : null
	);
	let back = $state.raw<Trains>(null);
	$effect(() => {
		void refresh;
		const at = backFrom;
		if (!data.hasNsKey || endsAtHome || !walk.endStation || !at) return;
		return loadTrains(walk.endStation, home, at, (t) => (back = t));
	});

	/** A train you might take, and whether you'll make it from where you are. */
	type Option = { trip: TripOption; planned: boolean; spare: number | null };
	const backOptions = $derived.by((): Option[] => {
		if (!back || 'error' in back) return [];
		return onePerDeparture(back.trips)
			.map((trip) => ({
				trip,
				planned:
					!!plan?.back &&
					formatTime(trip.legs[0]?.plannedDeparture ?? trip.departure) === plan.back,
				spare: readyAt ? minutesBetween(readyAt, trip.departure) : null
			}))
			.filter((o) => o.planned || o.spare === null || o.spare >= -5)
			.filter((o) => new Date(o.trip.departure).getTime() >= now - 60_000)
			.slice(0, 4);
	});

	// The train out, until you've set off: is it on time, which platform.
	const startsAtHome = $derived(walk.startStation === home);
	let out = $state.raw<Trains>(null);
	$effect(() => {
		void refresh;
		const want = plan?.out;
		if (!data.hasNsKey || !isToday || !want || startsAtHome || !walk.startStation) return;
		if (untrack(() => progress.started)) return;
		return loadTrains(home, walk.startStation, amsterdamIso(date, want), (t) => (out = t));
	});
	const outTrip = $derived.by(() => {
		if (!out || 'error' in out || !plan?.out) return null;
		const trip = out.trips.find(
			(t) => formatTime(t.legs[0]?.plannedDeparture ?? t.departure) === plan.out
		);
		return trip && new Date(trip.arrival).getTime() > now ? trip : null;
	});

	// --- Stopping early: the nearest station and the train home from there ---------------------------
	let stopping = $state(false);
	let stopPick = $state(0);
	const stops = $derived(
		stopping && fix ? closestStations([fix.lng, fix.lat], data.stations, 3) : []
	);
	const stop = $derived(stops[stopPick] ?? stops[0] ?? null);
	const stopMinutes = $derived(stop ? Math.ceil((stop.walkKm / pace.speedKmh) * 60) : 0);
	const atStop = $derived(stop ? new Date(now + stopMinutes * 60_000).toISOString() : null);
	let stopTrains = $state.raw<Trains>(null);
	const stopFrom = $derived(atStop ? floorTo(atStop, 5) : null);
	$effect(() => {
		const code = stop?.station.code;
		const at = stopFrom;
		stopTrains = null;
		if (!data.hasNsKey || !code || !at || code === home) return;
		return loadTrains(code, home, at, (t) => (stopTrains = t));
	});
	const stopOptions = $derived(
		stopTrains && 'trips' in stopTrains && atStop
			? onePerDeparture(stopTrains.trips)
					.filter((t) => t.departure >= atStop)
					.slice(0, 3)
			: []
	);
	/** A walking route to the station, by OpenStreetMap's planner: only when you tap it. */
	const stopRouteHref = $derived(
		fix && stop
			? `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${fix.lat.toFixed(5)},${fix.lng.toFixed(5)};${stop.station.lat},${stop.station.lng}`
			: null
	);

	// --- On a phone the panel lies over the map's bottom; the map keeps you clear of it ---------------
	let panelHeight = $state(0);
	let wide = $state(false);
	onMount(() => {
		const query = window.matchMedia('(min-width: 800px)');
		const set = () => (wide = query.matches);
		set();
		query.addEventListener('change', set);
		return () => query.removeEventListener('change', set);
	});

	const km = (n: number) => formatKm(n);
	const trainLine = (t: TripOption) => {
		const leg = t.legs[0];
		const delay = leg ? delayMinutes(leg) : 0;
		return { leg, delay, cancelled: t.status === 'CANCELLED' || !!leg?.cancelled };
	};
</script>

<svelte:head>
	<title>Onderweg: {walkHeading(walk)} · Treinwandelaar</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#snippet trainRow(t: TripOption, extra: { planned?: boolean; spare?: number | null } = {})}
	{@const { leg, delay, cancelled } = trainLine(t)}
	<li class="train" class:cancelled class:missed={extra.spare != null && extra.spare < 0}>
		<span class="time tabular"
			>{formatTime(leg?.plannedDeparture ?? t.departure)}{#if delay}<span class="delay">
					+{delay}</span
				>{/if}</span
		>
		<span class="what">
			{leg?.category ?? 'Trein'}{leg?.direction ? ` richting ${leg.direction}` : ''}{leg?.track
				? `, spoor ${leg.track}`
				: ''}
			<span class="muted"
				>· thuis {formatTime(t.arrival)}{t.transfers ? `, ${t.transfers}× overstappen` : ''}</span
			>
		</span>
		<span class="verdict">
			{#if cancelled}<span class="late">rijdt niet</span>
			{:else if extra.spare != null}
				{#if extra.spare >= 15}<span class="ok">ruim</span>
				{:else if extra.spare >= 0}<span class="tight">krap</span>
				{:else}<span class="late">haal je niet</span>{/if}
			{/if}
			{#if extra.planned}<span class="planned">gepland</span>{/if}
		</span>
	</li>
{/snippet}

<div class="day">
	<header>
		<a class="back" href={plannerHref}>Planner</a>
		<h1>{walkHeading(walk)}</h1>
		<p class="sub">
			{startLabel(walk)} → {walk.isLoop ? 'rondje' : endLabel(walk)} · {km(walk.distanceKm)} km · {dayLabel}
		</p>
	</header>

	<div class="map-area">
		<DayMap
			line={walk.geometry}
			startLabel={startLabel(walk)}
			endLabel={endLabel(walk)}
			isLoop={walk.isLoop}
			stations={data.stations}
			here={fix}
			{heading}
			alongM={progress.started ? progress.alongM : null}
			rejoin={rejoin?.at ?? null}
			target={stop
				? { lng: stop.station.lng, lat: stop.station.lat, name: stop.station.name }
				: null}
			bind:camera
			oncompass={enableCompass}
			bottom={wide ? 0 : panelHeight}
			{credit}
		/>
	</div>

	<section class="panel" bind:clientHeight={panelHeight} aria-label="Onderweg">
		{#if progress.wrongWay && fix}
			<p class="alert" role="alert">
				<strong>Je loopt de verkeerde kant op.</strong> Draai om: de route gaat de andere kant op.
			</p>
		{:else if rejoin}
			<p class="alert" role="alert">
				<strong>Je bent van de route af</strong>, ± {Math.round(rejoin.metres / 10) * 10} m. Terug naar
				de route: richting {rejoin.way}.
			</p>
		{/if}

		{#if !following}
			<button type="button" class="start" onclick={() => startFollowing()}>
				{progress.started ? 'Verder volgen' : 'Start: volg mijn locatie'}
			</button>
			<p class="muted small">
				{#if !isToday}Deze wandeling staat op {dayLabel}. Volgen kan altijd, de treinen rekenen met
					die dag.
				{:else}Je scherm blijft aan zolang je volgt. Je locatie blijft op je telefoon.{/if}
			</p>
		{:else if !fix}
			<p class="status muted">Je locatie zoeken…</p>
		{:else if toStartM !== null}
			<p class="status">
				<strong>Nog ± {km(toStartM / 1000)} km naar het begin</strong>, richting {compassWord(
					bearing([fix.lng, fix.lat], walk.geometry[0])
				)}. Daarna {km(walk.distanceKm)} km wandelen.
			</p>
		{:else}
			<p class="status">
				<strong class="tabular">Nog {km(toGoKm)} km</strong>
				{#if endAt}· aankomst ± <strong class="tabular">{formatTime(endAt)}</strong>{/if}
				<span class="muted small"
					>{measuredKmh
						? `op jouw tempo van vandaag, ${km(measuredKmh)} km/u met pauzes`
						: `met je tempo uit de planner, ${km(pace.speedKmh)} km/u`}</span
				>
			</p>
		{/if}
		{#if fix && fix.accuracyM > 100}<p class="muted small">
				Je locatie is onnauwkeurig (± {Math.round(fix.accuracyM)} m).
			</p>{/if}
		{#if locationProblem}<p class="notice">{locationProblem}</p>{/if}

		{#if outTrip}
			{@const { leg, delay, cancelled } = trainLine(outTrip)}
			<h2>Heen</h2>
			<p class="out" class:cancelled>
				<strong class="tabular"
					>{formatTime(leg?.plannedDeparture ?? outTrip.departure)}{#if delay}<span class="delay">
							+{delay}</span
						>{/if}</strong
				>
				{leg?.category ?? 'Trein'} van {leg?.from ?? homeStation?.name}{#if leg?.track}, spoor {leg.track}{/if};
				aan in {walk.startStationName} om {formatTime(outTrip.arrival)}.
				{#if cancelled}<span class="late"
						>Deze trein rijdt niet; kijk in de planner voor een andere.</span
					>{/if}
			</p>
		{/if}

		{#if !endsAtHome && walk.endStation && data.hasNsKey}
			<h2>Terug naar {homeStation?.name ?? 'huis'}</h2>
			{#if endAccess === 'bus'}
				<p class="small">
					{#if endRide}
						{endRide.line} om <strong class="tabular">{formatTime(endRide.departure)}</strong> van {endRide.from}
						naar {endRide.to}, aan {formatTime(endRide.arrival)}.
					{:else}
						Van {walk.endPlace ?? 'het eind'} met de bus of een taxi naar {walk.endStationName}; ± {busMinutes(
							walk.endStationM!
						)} min.
					{/if}
				</p>
			{:else if endAccess === 'walk'}
				<p class="small muted">
					Nog ± {accessMinutes(walk.endStationM!, pace.speedKmh)} min lopen naar station {walk.endStationName}.
				</p>
			{/if}
			{#if readyAt}<p class="small">
					Op het perron in {walk.endStationName}: ±
					<strong class="tabular">{formatTime(readyAt)}</strong>.
				</p>{/if}
			{#if back && 'error' in back}
				<p class="notice">Treintijden ophalen mislukt: {back.error}</p>
			{:else if back && back.savedAt}
				<p class="notice">
					Geen verbinding: dit zijn de treintijden van {formatTime(
						new Date(back.savedAt).toISOString()
					)}.
				</p>
			{/if}
			{#if backOptions.length}
				<ul class="trains">
					{#each backOptions as o (o.trip.departure)}
						{@render trainRow(o.trip, { planned: o.planned, spare: isToday ? o.spare : null })}
					{/each}
				</ul>
			{:else if !backFrom}
				<p class="muted small">Zodra je volgt, zie je welke treinen terug je haalt.</p>
			{:else if back && 'trips' in back}
				<p class="notice">Geen treinen meer gevonden vanaf {walk.endStationName}.</p>
			{:else}
				<p class="muted small">Treinen zoeken…</p>
			{/if}
		{/if}

		{#if fix}
			<details class="stop" bind:open={stopping}>
				<summary>Eerder stoppen?</summary>
				{#if stop}
					<div class="stops" role="radiogroup" aria-label="Dichtstbijzijnde stations">
						{#each stops as s, i (s.station.code)}
							<button
								type="button"
								role="radio"
								aria-checked={s === stop}
								onclick={() => (stopPick = i)}
								>{s.station.name} <span class="muted tabular">{km(s.walkKm)} km</span></button
							>
						{/each}
					</div>
					<p class="small">
						Station {stop.station.name}: ± {km(stop.walkKm)} km, ± {formatDuration(stopMinutes)} lopen.
						{#if stopRouteHref}<a href={stopRouteHref} target="_blank" rel="noreferrer"
								>Looproute erheen</a
							>{/if}
					</p>
					{#if stop.station.code === home}
						<p class="small">Dat is je eigen station: je loopt naar huis.</p>
					{:else if stopOptions.length}
						<ul class="trains">
							{#each stopOptions as t (t.departure)}{@render trainRow(t)}{/each}
						</ul>
					{:else if stopTrains && 'error' in stopTrains}
						<p class="notice">Treintijden ophalen mislukt: {stopTrains.error}</p>
					{:else if data.hasNsKey}
						<p class="muted small">Treinen zoeken…</p>
					{/if}
				{/if}
			</details>
		{/if}

		{#if following}
			<button type="button" class="quiet" onclick={stopFollowing}>Stop met volgen</button>
		{/if}
	</section>
</div>

<style>
	/* The whole screen: a bar, the map, and the panel (under the map on a phone, beside it when wide). */
	.day {
		display: grid;
		grid-template-rows: auto 1fr;
		height: 100dvh;
		background: var(--paper);
	}

	header {
		grid-column: 1 / -1;
		padding: 8px 16px;
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}

	.back {
		color: var(--rail);
		font-size: var(--step--1);
		text-decoration: none;
	}

	.back::before {
		content: '‹ ';
	}

	h1 {
		margin: 0;
		font-size: var(--step-1);
		line-height: 1.2;
		font-weight: 800;
	}

	.sub {
		margin: 0;
		color: var(--muted);
		font-size: var(--step--1);
	}

	.map-area {
		position: relative;
		min-height: 0;
	}

	.panel {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		max-height: 48dvh;
		overflow-y: auto;
		padding: 10px 16px calc(12px + env(safe-area-inset-bottom));
		background: var(--surface);
		border-top: 1px solid var(--line);
		box-shadow: 0 -2px 12px var(--shadow);
		border-radius: 12px 12px 0 0;
	}

	@media (min-width: 800px) {
		.day {
			grid-template-columns: var(--panel-width) 1fr;
		}

		.map-area {
			grid-column: 2;
			grid-row: 2;
		}

		.panel {
			position: static;
			grid-column: 1;
			grid-row: 2;
			max-height: none;
			border-top: 0;
			border-right: 1px solid var(--line);
			border-radius: 0;
			box-shadow: none;
		}
	}

	h2 {
		margin: 14px 0 4px;
		font-size: var(--step-0);
		font-weight: 700;
	}

	p {
		margin: 4px 0;
	}

	.small {
		font-size: var(--step--1);
	}

	.muted {
		color: var(--muted);
	}

	.status {
		font-size: var(--step-1);
		line-height: 1.35;
	}

	.status .small {
		display: block;
	}

	.alert {
		margin: 0 0 8px;
		padding: 8px 10px;
		border-left: 4px solid var(--warn);
		background: var(--notice-bg);
	}

	.alert strong {
		color: var(--warn);
	}

	.notice {
		padding: 6px 9px;
		border-left: 3px solid var(--warn);
		background: var(--notice-bg);
		font-size: var(--step--1);
	}

	.start {
		width: 100%;
		padding: 10px 14px;
		border: 0;
		border-radius: var(--radius);
		background: var(--signal);
		color: var(--on-signal);
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.quiet {
		margin-top: 12px;
		padding: 4px 12px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--surface);
		color: var(--muted);
		font-size: var(--step--1);
		cursor: pointer;
	}

	.trains {
		margin: 4px 0 0;
		padding: 0;
		list-style: none;
	}

	/* Time | what | verdict, one train a line. */
	.train {
		display: grid;
		grid-template-columns: 4.2rem 1fr auto;
		align-items: baseline;
		gap: 8px;
		padding: 5px 0;
		border-top: 1px solid var(--line);
		font-size: var(--step--1);
	}

	.train .time {
		font-size: var(--step-0);
		font-weight: 700;
	}

	.train.missed,
	.train.cancelled .time {
		color: var(--muted);
	}

	.train.cancelled .time {
		text-decoration: line-through;
	}

	.delay,
	.late {
		color: var(--warn);
		font-weight: 700;
	}

	.verdict {
		display: flex;
		gap: 6px;
		white-space: nowrap;
	}

	/* The good news as a yellow tag; "krap" stays bold, "haal je niet" orange. */
	.ok {
		padding: 0 6px;
		border-radius: 999px;
		background: var(--signal);
		color: var(--on-signal);
		font-weight: 700;
	}

	.tight {
		font-weight: 700;
	}

	.planned {
		padding: 0 6px;
		border: 1px solid var(--line);
		border-radius: 999px;
		color: var(--muted);
	}

	.out.cancelled strong {
		text-decoration: line-through;
	}

	.stop {
		margin-top: 14px;
	}

	.stop summary {
		font-weight: 700;
		cursor: pointer;
	}

	.stops {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 8px 0 4px;
	}

	.stops button {
		padding: 3px 10px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--surface);
		color: var(--ink);
		font-size: var(--step--1);
		cursor: pointer;
	}

	.stops button[aria-checked='true'] {
		border-color: var(--signal);
		background: var(--signal);
		color: var(--on-signal);
	}

	.stops button[aria-checked='true'] .muted {
		color: inherit;
	}

	.stop a {
		color: var(--rail);
	}
</style>
