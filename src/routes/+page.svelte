<script lang="ts">
	import { FAMILY_SITE } from '$app/env/public';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import WalkMap from '#lib/components/WalkMap.svelte';
	import WalkDetail from '#lib/components/WalkDetail.svelte';
	import Mark from '#lib/components/Mark.svelte';
	import StationPicker from '#lib/components/StationPicker.svelte';
	import MapLegend from '#lib/components/MapLegend.svelte';
	import RoutePlanner from '#lib/components/RoutePlanner.svelte';
	import RangeSlider from '#lib/components/RangeSlider.svelte';
	import { stretchId } from '#lib/path.js';
	import { amsterdamYmd, formatDuration, nextSaturdayMorning, travelBand } from '#lib/itinerary.js';
	import {
		COLLECTION_LABELS,
		type Collection,
		type Disruption,
		type PathDetail,
		type Reachability,
		type ReachabilityResponse,
		type TripLeg,
		type WalkDetail as WalkDetailData,
		type WalkSummary
	} from '#lib/types.js';
	import {
		endLabel,
		needsBus,
		osmCredit,
		reverseWalk,
		startLabel,
		walkPath,
		walkTitle,
		WANDELNET_MELDPUNT,
		wandelnetCredit
	} from '#lib/walk.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/**
	 * The walks' lines, fetched apart from the page data: they are most of its bytes, and inlined in
	 * the HTML they took it near the 2 MB a search engine reads of a page. Until they are in, the list
	 * works and the map shows no walks.
	 */
	let lines = $state.raw<Record<string, [number, number][]>>({});
	onMount(() => {
		fetch('/api/walk-lines')
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((l) => (lines = l))
			.catch(() => {
				/* the list still works; the map just has no walks */
			});
	});

	/** Walks you saved a status or rating on since the page loaded, in place of their loaded copy. */
	let saved = $state.raw<Record<string, WalkSummary>>({});
	const walks = $derived(
		data.walks.map((w): WalkSummary => saved[w.id] ?? { ...w, geometry: lines[w.id] ?? [] })
	);

	// --- Home station (remembered per browser) ------------------------------------------------------
	const HOME_KEY = 'treinwandelaar.home';
	let home = $state(readHome());

	function readHome(): string {
		try {
			return (
				(typeof localStorage !== 'undefined' && localStorage.getItem(HOME_KEY)) || data.defaultHome
			);
		} catch {
			return data.defaultHome;
		}
	}

	$effect(() => {
		try {
			localStorage.setItem(HOME_KEY, home);
		} catch {
			/* private mode: fine, just not remembered */
		}
	});

	const homeStation = $derived(data.stations.find((s) => s.code === home) ?? data.stations[0]);

	// --- Travel day: as far ahead as the timetable goes, defaulting to the coming Saturday ----------
	let day = $state(nextSaturdayMorning().slice(0, 10));
	const today = amsterdamYmd();
	const tomorrow = amsterdamYmd(new Date(Date.now() + 24 * 3600_000));
	// Without a timetable every day costs a round of NS planner calls; keep to the coming week then.
	const lastDay = $derived(data.lastDay ?? amsterdamYmd(new Date(Date.now() + 7 * 24 * 3600_000)));

	/** "za 17 okt", or "vandaag, do 15 okt" and "morgen, …" for the next two days. */
	function dayLabel(ymd: string) {
		// Noon UTC is the same date in Amsterdam, whatever the season.
		const label = new Date(`${ymd}T12:00:00Z`).toLocaleDateString('nl-NL', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			timeZone: 'Europe/Amsterdam'
		});
		return ymd === today ? `vandaag, ${label}` : ymd === tomorrow ? `morgen, ${label}` : label;
	}

	/** The date field shows no weekday, and the weekday is what you pick a walking day by. */
	const weekday = (ymd: string) =>
		ymd === today
			? 'vandaag'
			: ymd === tomorrow
				? 'morgen'
				: new Date(`${ymd}T12:00:00Z`).toLocaleDateString('nl-NL', {
						weekday: 'long',
						timeZone: 'Europe/Amsterdam'
					});

	/** A cleared field or a typed date outside the timetable keeps the day you had. */
	function pickDay(e: Event & { currentTarget: HTMLInputElement }) {
		const ymd = e.currentTarget.value;
		if (ymd && ymd >= today && ymd <= lastDay) day = ymd;
		else e.currentTarget.value = day;
	}

	// --- Travel times from home, and disruptions on the way ----------------------------------------
	let reachability = $state<Reachability>({});
	let reachBack = $state<Reachability>({});
	let disruptions = $state<Record<string, Disruption>>({});
	let closed = $state<Record<string, string[]>>({});
	let reachSource = $state<'timetable' | 'ns'>('timetable');
	let reachStatus = $state<'idle' | 'loading' | 'error' | 'incomplete' | 'refused'>('idle');
	/** Why the server won't ask NS for this day (a 4xx for a day outside the timetable). */
	let reachRefusal = $state<{ status: number; message: string } | null>(null);

	$effect(() => {
		const controller = new AbortController();
		// Drop the previous home's times at once: showing them under the new station is worse than "–".
		reachability = {};
		reachBack = {};
		disruptions = {};
		closed = {};
		reachStatus = 'loading';
		reachRefusal = null;
		const params = new URLSearchParams({ from: home, date: day });
		fetch(`/api/reachability?${params}`, { signal: controller.signal })
			.then(async (r) => {
				if (r.ok) return r.json();
				if (r.status === 400 || r.status === 403) {
					const body = await r.json().catch(() => ({}));
					reachRefusal = { status: r.status, message: body.message ?? `HTTP ${r.status}` };
				}
				throw new Error(`HTTP ${r.status}`);
			})
			.then((r: ReachabilityResponse) => {
				reachability = r.times;
				reachBack = r.back;
				disruptions = r.disruptions;
				closed = r.closed ?? {};
				reachSource = r.source;
				reachStatus = r.incomplete ? 'incomplete' : 'idle';
			})
			.catch(() => {
				if (!controller.signal.aborted) reachStatus = reachRefusal ? 'refused' : 'error';
			});
		return () => controller.abort();
	});

	const minutesTo = (w: WalkSummary) =>
		w.startStation ? reachability[w.startStation]?.minutes : undefined;

	const minutesBack = (w: WalkSummary) =>
		w.endStation ? reachBack[w.endStation]?.minutes : undefined;

	/** Works or disruptions on the train out to the start or the train home from the end, that day. */
	function walkDisruptions(w: WalkSummary): Disruption[] {
		const ids = new Set<string>([
			...((w.startStation && reachability[w.startStation]?.disruptions) || []),
			...((w.endStation && reachBack[w.endStation]?.disruptions) || []),
			...((w.startStation && closed[w.startStation]) || []),
			...((w.endStation && closed[w.endStation]) || [])
		]);
		return [...ids].map((id) => disruptions[id]).filter(Boolean);
	}

	// --- One LAW route or streekpad, to plan your own stretches of it ------------------------------
	// In the URL like the walk, so a reload or a link keeps it.
	const routeId = $derived(page.url.searchParams.get('route'));
	let path = $state.raw<PathDetail | null>(null);
	/** The stretch you're putting together on it, as station codes. */
	let stretch = $state<{ from: string | null; to: string | null }>({ from: null, to: null });

	$effect(() => {
		const id = routeId;
		if (!id) {
			path = null;
			return;
		}
		if (path?.id === id) return;
		const controller = new AbortController();
		fetch(`/api/paths/${encodeURIComponent(id)}`, { signal: controller.signal })
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((p: PathDetail) => (path = p))
			.catch(() => {
				if (!controller.signal.aborted) pickRoute('');
			});
		return () => controller.abort();
	});

	/** Plan on another route, or none (''): from the filter, the planner, or a route on the map. */
	function pickRoute(id: string) {
		stretch = { from: null, to: null };
		const url = new URL(page.url.href);
		if (id) url.searchParams.set('route', id);
		else url.searchParams.delete('route');
		url.searchParams.delete('walk');
		url.searchParams.delete('reverse');
		goto(url, { reset: false, replace: true });
	}

	const routeGroups = $derived(
		(['law', 'streekpad'] as const).map((c) => ({
			label: COLLECTION_LABELS[c],
			paths: data.paths.filter((p) => p.collection === c)
		}))
	);

	// --- Filters & sorting --------------------------------------------------------------------------
	let maxTravel = $state(180);
	/**
	 * One slider for the distance, both ends open: the shortest walks the ingest makes are 5 km
	 * (scripts/ingest/osm.ts) and the longest about 25, so 5 is "no minimum" and 25 "no maximum".
	 */
	let minKm = $state(5);
	let maxKm = $state(25);
	const distanceLabel = $derived(
		minKm <= 5 && maxKm >= 25
			? 'alles'
			: minKm <= 5
				? `≤ ${maxKm} km`
				: maxKm >= 25
					? `≥ ${minKm} km`
					: minKm === maxKm
						? `${minKm} km`
						: `${minKm}–${maxKm} km`
	);
	let hideDone = $state(false);
	const collections = Object.keys(COLLECTION_LABELS) as Collection[];
	let shown = $state<Collection[]>([...collections]);
	const countBy = $derived(
		Object.fromEntries(
			collections.map((c) => [c, walks.filter((w) => w.collection === c).length])
		) as Record<Collection, number>
	);

	function toggleCollection(c: Collection) {
		shown = shown.includes(c) ? shown.filter((x) => x !== c) : [...shown, c];
	}
	let noBus = $state(false);
	let hideDisrupted = $state(false);

	/**
	 * The whole LAW routes and streekpaden, faint under the walks: off by default, so the map stays
	 * about walks you can reach by train. Remembered per browser, like the home station.
	 */
	const ROUTES_KEY = 'treinwandelaar.routes';
	let showRoutes = $state(readShowRoutes());

	function readShowRoutes(): boolean {
		try {
			return typeof localStorage !== 'undefined' && localStorage.getItem(ROUTES_KEY) === '1';
		} catch {
			return false;
		}
	}

	$effect(() => {
		try {
			localStorage.setItem(ROUTES_KEY, showRoutes ? '1' : '0');
		} catch {
			/* private mode: fine, just not remembered */
		}
	});
	let sort = $state<'travel' | 'rating' | 'distance' | 'name'>('travel');

	/** Small screens fold the filters away so the list starts under the map; this says how many bite. */
	let filtersOpen = $state(false);
	const activeFilters = $derived(
		[
			maxTravel < 180,
			minKm > 5,
			maxKm < 25,
			shown.length < collections.filter((c) => countBy[c]).length,
			hideDone,
			noBus,
			hideDisrupted
		].filter(Boolean).length
	);

	const visible = $derived.by(() => {
		const list = walks.filter((w) => {
			const t = minutesTo(w);
			if (maxTravel < 180 && t != null && t > maxTravel) return false;
			if (minKm > 5 && w.distanceKm < minKm) return false;
			if (maxKm < 25 && w.distanceKm > maxKm) return false;
			// On one route, its own day walks; the route says what kind they are.
			if (routeId ? !w.id.startsWith(`${routeId}:`) : !shown.includes(w.collection)) return false;
			if (hideDone && w.status === 'done') return false;
			if (noBus && needsBus(w)) return false;
			if (hideDisrupted && walkDisruptions(w).length) return false;
			return true;
		});
		const by: Record<typeof sort, (a: WalkSummary, b: WalkSummary) => number> = {
			travel: (a, b) => (minutesTo(a) ?? 999) - (minutesTo(b) ?? 999),
			rating: (a, b) => (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0),
			distance: (a, b) => a.distanceKm - b.distanceKm,
			name: (a, b) => a.name.localeCompare(b.name, 'nl')
		};
		return list.sort(by[sort]);
	});

	// --- The list grows as you scroll: a thousand rows at once make the first paint slow -----------
	const PAGE_SIZE = 50;
	let listed = $state(PAGE_SIZE);
	const listedWalks = $derived(visible.slice(0, listed));

	// A new filter, sort, home or day is a new list: start again from its top.
	$effect(() => {
		void visible;
		listed = PAGE_SIZE;
	});

	/** The "toon meer" button loads the next page by itself once you scroll near it. */
	function loadWhenNear(button: HTMLButtonElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) listed += PAGE_SIZE;
			},
			{ rootMargin: '600px 0px' }
		);
		observer.observe(button);
		return () => observer.disconnect();
	}

	// --- Selection lives in the URL so reloads and links keep it ------------------------------------
	const selectedId = $derived(page.url.searchParams.get('walk'));
	let panel: HTMLElement;
	let mapArea: HTMLElement;
	let scrollY = $state(0);

	/**
	 * Small screens scroll the page, and the list is a sheet over a map taller than the 45% it
	 * shows at first: the page opens this far down, so pulling the list down shows more map.
	 */
	function sheetRest() {
		if (!mapArea || window.matchMedia('(min-width: 800px)').matches) return 0;
		return Math.max(0, Math.round(mapArea.offsetHeight - window.innerHeight * 0.45));
	}

	/** How much of the map's bottom the list covers (the head is stuck to the top, so: the scroll). */
	const mapCovered = () => (window.matchMedia('(min-width: 800px)').matches ? 0 : window.scrollY);

	// Switching between list and detail should start at the top, not the list's scroll position.
	$effect(() => {
		void selectedId;
		panel?.scrollTo({ top: 0 });
		window.scrollTo({ top: sheetRest() });
	});

	// The server opens ?walk= only on the first render; after that the page fetches the one walk.
	let details = $state.raw<Record<string, WalkDetailData>>({});
	const detail = (id: string) =>
		details[id] ?? (data.selected?.id === id ? data.selected : undefined);
	/** Walking the open walk the other way round (?reverse=1): it, its trains and its map turned around. */
	const reversed = $derived(page.url.searchParams.get('reverse') === '1');
	const selected = $derived.by(() => {
		const walk = (selectedId && detail(selectedId)) || null;
		return walk && reversed ? reverseWalk(walk) : walk;
	});
	/**
	 * A stretch you planned yourself isn't in the list; the map shows it all the same. The open walk
	 * is drawn as you'd walk it, so its start and end markers follow a reversal.
	 */
	const mapWalks = $derived(
		(selected
			? visible.some((w) => w.id === selected.id)
				? visible.map((w) => (w.id === selected.id ? selected : w))
				: [...visible, selected]
			: visible
		).filter((w) => w.geometry.length)
	);

	function reverse() {
		const url = new URL(page.url.href);
		if (reversed) url.searchParams.delete('reverse');
		else url.searchParams.set('reverse', '1');
		goto(url, { reset: false, replace: true });
	}

	/**
	 * The list row under the mouse (or keyboard focus), drawn out on the map. Mouse only: a tap on a
	 * phone opens the walk anyway. The row is gone once a walk opens, so it never gets a leave event.
	 */
	let hoveredId = $state<string | null>(null);
	const hover = (id: string) => (e: PointerEvent) => {
		if (e.pointerType === 'mouse') hoveredId = id;
	};
	const unhover = (id: string) => () => {
		if (hoveredId === id) hoveredId = null;
	};

	// The planner's date and time, kept from walk to walk. Stamped with the list's day: pick another
	// travel day there and the planner starts over from it.
	let trip = $state<{ date: string; time: string; day: string } | null>(null);
	/** One travel day: a date picked in the planner is the list's and map's day too, if the timetable covers it. */
	function keepTrip(t: { date: string; time: string }) {
		if (t.date >= today && t.date <= lastDay) day = t.date;
		trip = { ...t, day };
	}

	/** The open walk's chosen trains out and back, drawn faintly under it on the map. */
	let tripLegs = $state.raw<TripLeg[][]>([]);
	/** And its chosen buses between station and route, where they run (empty: unknown). */
	let feederLines = $state.raw<{ start: [number, number][]; end: [number, number][] }>({
		start: [],
		end: []
	});

	async function fetchWalk(id: string, signal: AbortSignal): Promise<WalkDetailData> {
		const r = await fetch(`/api/walks/${encodeURIComponent(id)}`, { signal });
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return r.json();
	}

	// Back and forward change the URL first; fetch the walk it names.
	$effect(() => {
		const id = selectedId;
		if (!id || detail(id)) return;
		const controller = new AbortController();
		fetchWalk(id, controller.signal)
			.then(remember)
			// Gone since the list loaded (or the link was wrong): back to the list.
			.catch(() => {
				if (!controller.signal.aborted) select(null, true);
			});
		return () => controller.abort();
	});

	/** A save answers with the updated walk: show it, and let the list and map follow. */
	function onsaved(walk: WalkDetailData) {
		remember(walk);
		saved = { ...saved, [walk.id]: walk };
	}

	function remember(walk: WalkDetailData) {
		details = { ...details, [walk.id]: walk };
	}

	/** A click fetches the walk before changing the URL, so the panel swaps in one go. */
	let opening: AbortController | undefined;
	async function select(id: string | null, replaceState = false) {
		opening?.abort();
		if (id && !detail(id)) {
			const controller = (opening = new AbortController());
			try {
				remember(await fetchWalk(id, controller.signal));
			} catch {
				return; // superseded by another click, or the walk is gone: stay where you are
			}
		}
		hoveredId = null;
		const url = new URL(page.url.href);
		if (id) url.searchParams.set('walk', id);
		else url.searchParams.delete('walk');
		// Another walk (or none) starts the right way round.
		url.searchParams.delete('reverse');
		goto(url, { reset: false, replaceState });
	}

	/**
	 * A row in the list is a link to the walk's own page, for search engines and for opening it in a
	 * new tab; a plain click opens it here, on the map, as before.
	 */
	const openHere = (id: string) => (e: MouseEvent) => {
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		select(id);
	};

	const km = (n: number) => n.toLocaleString('nl-NL', { maximumFractionDigits: 1 });

	const TITLE = 'Treinwandelaar: dagwandelingen van station naar station';
	const DESCRIPTION =
		'Dagwandelingen met de trein in Nederland: LAW-routes, streekpaden en lokale wandelingen die bij ' +
		'een station beginnen en eindigen, met de reistijd vanaf jouw station.';

	// The demo shows only OpenStreetMap walks; signed-in users get those Wandelnet doesn't cover.
	const hasOsm = $derived(walks.some((w) => w.source === 'osm'));
	const mapCredit = $derived(
		data.demo
			? osmCredit(data.osmUpdated)
			: wandelnetCredit(data.wandelnetUpdated) + (hasOsm ? '; andere routes © OpenStreetMap' : '')
	);
</script>

<svelte:head>
	<title>{selected ? walkTitle(selected) : TITLE}</title>
	<meta name="description" content={DESCRIPTION} />
	<link rel="canonical" href="{page.url.origin}/" />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={TITLE} />
	<meta property="og:description" content={DESCRIPTION} />
	<meta property="og:url" content="{page.url.origin}/" />
	{@html `<script type="application/ld+json">${JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		name: 'Treinwandelaar',
		url: `${page.url.origin}/`,
		inLanguage: 'nl',
		description: DESCRIPTION
	}).replaceAll('<', '\\u003c')}</script>`}
</svelte:head>

<svelte:window bind:scrollY />

<div class="app">
	<!-- The bar and the map stay put on small screens while the list slides over them. -->
	<div class="head">
		<!-- "<family site> / treinwandelaar", the same order as the nav on the family's other sites,
	     with the family's light/dark switch last. Outside the panel on purpose: family.js only wires
	     up switches that exist when the page loads, and the panel re-renders. -->
		<header class="topbar">
			<div class="brand">
				{#if FAMILY_SITE}<a class="up" href={FAMILY_SITE}>{new URL(FAMILY_SITE).host}</a><span
						class="sep"
						aria-hidden="true">/</span
					>{/if}<a class="here" href="/"><Mark />treinwandelaar</a>
			</div>
			<div class="bar-actions">
				<button type="button" class="sources-toggle" popovertarget="sources">Bronnen</button>
				<button class="theme-toggle" aria-label="Donkere modus" hidden></button>
			</div>
		</header>
		<!-- Who the routes come from, one tap away from anywhere instead of below the whole list. -->
		<div id="sources" class="sources" popover>
			<p>
				{#if data.demo}
					{osmCredit(data.osmUpdated)}: routes van Wandelnet en andere beheerders, ingetekend door
					vrijwilligers.
					<a href="/api/osm-walks.geojson" data-sveltekit-reload>Download (ODbL)</a>.
				{:else}
					{wandelnetCredit(data.wandelnetUpdated)}; foto's en praktische info van NS. Iets mis op
					een route?
					<a href={WANDELNET_MELDPUNT} target="_blank" rel="noreferrer">Meld het bij Wandelnet</a>.
					Alleen voor persoonlijk gebruik.
					{#if hasOsm}Andere routes © OpenStreetMap-bijdragers (ODbL).{/if}
				{/if}
			</p>
		</div>

		<div class="map-area" bind:this={mapArea} style:--sheet-cover="{scrollY}px">
			<WalkMap
				walks={mapWalks}
				{path}
				stations={data.stations}
				{home}
				{reachability}
				{selectedId}
				hoveredId={selected ? null : hoveredId}
				trips={selected ? tripLegs : []}
				rides={selected ? feederLines : undefined}
				credit={mapCredit}
				onselect={select}
				routeKinds={showRoutes && !routeId ? shown : []}
				onroute={pickRoute}
				onlocate={(code) => (home = code)}
				obscured={mapCovered}
			/>
			<MapLegend
				transit={!!selected}
				homeName={homeStation?.name ?? ''}
				dayLabel={dayLabel(day)}
				loading={reachStatus === 'loading'}
			/>
		</div>
	</div>

	<aside class="panel" bind:this={panel}>
		{#if selected && homeStation}
			{#key selected.id}
				<WalkDetail
					walk={selected}
					home={homeStation}
					hasNsKey={data.hasNsKey}
					demo={data.demo}
					{day}
					trip={trip?.day === day ? trip : null}
					ontrip={keepTrip}
					onlegs={(t) => (tripLegs = t)}
					onrides={(r) => (feederLines = r)}
					disruptions={walkDisruptions(selected)}
					onclose={() => select(null)}
					{reversed}
					onreverse={reverse}
					onopen={(id) => select(id)}
					{onsaved}
				/>
			{/key}
		{:else}
			<header class="intro">
				<h1>Dagwandelingen met de trein, van station naar station</h1>
				<StationPicker stations={data.stations} bind:value={home} label="Ik vertrek vanaf" />
			</header>
			{#if data.demo}
				<p class="demo">
					Demo met LAW-routes, streekpaden en lokale wandelingen uit OpenStreetMap.
					<a href="/login" data-sveltekit-reload>Inloggen</a> voor meer wandelingen en om bij te houden
					wat je wilt lopen.
				</p>
			{/if}

			<!-- Outside the filters, which fold away on a phone: planning on a route is a way in, not a filter. -->
			{#if data.paths.length}
				<label class="route-pick">
					<span>Etappes plannen</span>
					<select value={routeId ?? ''} onchange={(e) => pickRoute(e.currentTarget.value)}>
						<option value="">kies een LAW-route of streekpad</option>
						{#each routeGroups as group (group.label)}
							{#if group.paths.length}
								<optgroup label={group.label}>
									{#each group.paths as p (p.id)}
										<option value={p.id}>{p.name}</option>
									{/each}
								</optgroup>
							{/if}
						{/each}
					</select>
				</label>
			{/if}

			<button
				type="button"
				class="filters-toggle"
				aria-expanded={filtersOpen}
				aria-controls="filters"
				onclick={() => (filtersOpen = !filtersOpen)}
			>
				<span>{dayLabel(day)}</span>
				<span class="toggle-label"
					>Filters{#if activeFilters}<span class="badge tabular">{activeFilters}</span>{/if}</span
				>
			</button>

			<div class="filters" id="filters" class:open={filtersOpen}>
				<label>
					<span>Reisdag</span>
					<input
						type="date"
						class="day"
						value={day}
						min={today}
						max={lastDay}
						required
						onchange={pickDay}
					/>
					<output>{weekday(day)}</output>
				</label>
				<label>
					<span>Max. reistijd heen</span>
					<input type="range" min="30" max="180" step="15" bind:value={maxTravel} />
					<output class="tabular">{maxTravel >= 180 ? 'alles' : formatDuration(maxTravel)}</output>
				</label>
				<div class="row" role="group" aria-labelledby="distance-label">
					<span id="distance-label">Afstand</span>
					<RangeSlider
						min={5}
						max={25}
						bind:low={minKm}
						bind:high={maxKm}
						lowLabel="Minimale afstand"
						highLabel="Maximale afstand"
					/>
					<output class="tabular">{distanceLabel}</output>
				</div>
				{#if !routeId}
					<div class="kinds" role="group" aria-label="Soort wandeling">
						{#each collections as c (c)}
							{#if countBy[c]}
								<button
									type="button"
									aria-pressed={shown.includes(c)}
									onclick={() => toggleCollection(c)}
								>
									{COLLECTION_LABELS[c]} <span class="tabular">{countBy[c]}</span>
								</button>
							{/if}
						{/each}
					</div>
				{/if}
				<div class="checks">
					{#if !data.demo}
						<label><input type="checkbox" bind:checked={hideDone} /> Verberg gelopen</label>
					{/if}
					<label><input type="checkbox" bind:checked={noBus} /> Alleen station tot station</label>
					<label
						><input type="checkbox" bind:checked={hideDisrupted} /> Zonder werkzaamheden of storingen</label
					>
					{#if data.paths.length}
						<label
							><input type="checkbox" bind:checked={showRoutes} /> Hele LAW-routes en streekpaden op de
							kaart</label
						>
					{/if}
				</div>
				<label class="sort">
					<span>Sorteer op</span>
					<select bind:value={sort}>
						<option value="travel">reistijd</option>
						<option value="rating">waardering</option>
						<option value="distance">afstand</option>
						<option value="name">naam</option>
					</select>
				</label>
			</div>

			{#if !data.hasNsKey}
				<p class="notice">
					Zonder <code>NS_API_KEY</code> in <code>.env</code> geen werkzaamheden, storingen en vertrektijden;
					de reistijden komen wel uit de dienstregeling.
				</p>
			{/if}
			{#if reachStatus === 'loading'}
				<p class="hint" role="status">Reistijden vanaf {homeStation?.name} berekenen…</p>
			{:else if reachStatus === 'idle' && reachSource === 'ns'}
				<p class="hint">
					Deze dag valt buiten de geladen dienstregeling; reistijden komen van de NS-planner.
				</p>
			{:else if reachStatus === 'incomplete'}
				<p class="notice">
					Nog niet alle reistijden: de NS-limiet (300 verzoeken per 5 minuten) is bereikt. Herlaad
					over een paar minuten; wat al binnen is, blijft bewaard.
				</p>
			{:else if reachStatus === 'refused' && reachRefusal}
				<p class="notice">
					{reachRefusal.message}
					{#if reachRefusal.status === 403}<a href="/login" data-sveltekit-reload>Inloggen</a>{/if}
				</p>
			{:else if reachStatus === 'error'}
				<p class="notice">
					Reistijden ophalen mislukt. De lijst werkt wel, alleen zonder reistijd.
				</p>
			{/if}

			{#if path && path.id === routeId}
				<RoutePlanner
					{path}
					{reachability}
					{reachBack}
					bind:from={stretch.from}
					bind:to={stretch.to}
					onplan={(from, to) => select(stretchId(path!.id, from, to))}
					onclose={() => pickRoute('')}
				/>
			{/if}

			<p class="count">
				{#if routeId}
					{visible.length} kant-en-klare dagwandelingen op deze route
				{:else}
					{visible.length} van {walks.length} wandelingen ·
					<a href="/route/" data-sveltekit-reload>alle op een rij</a>
				{/if}
			</p>

			{#if visible.length}
				<ul class="walks">
					{#each listedWalks as w (w.id)}
						{@const t = minutesTo(w)}
						{@const hits = walkDisruptions(w)}
						{@const b = minutesBack(w)}
						<li>
							<a
								href={walkPath(w.id)}
								data-sveltekit-preload-data="off"
								onclick={openHere(w.id)}
								onpointerenter={hover(w.id)}
								onpointerleave={unhover(w.id)}
								onfocus={() => (hoveredId = w.id)}
								onblur={unhover(w.id)}
							>
								<span class="name">{w.name}</span>
								<span class="stations">
									{startLabel(w)}
									{w.isLoop ? '(rondje)' : `naar ${endLabel(w)}`}
									{#if needsBus(w)}<em>met bus</em>{/if}
									{#if w.status === 'done'}<em class="done">gelopen</em>{/if}
									{#if hits.length}
										<em class="disrupted"
											>{hits.some((d) => d.type === 'storing') ? 'storing' : 'werkzaamheden'}</em
										>
									{/if}
								</span>
								<span class="numbers tabular">
									<span class="travel band-{travelBand(t)}"
										>{t != null ? formatDuration(t) : '–'}</span
									>
									{#if !w.isLoop && b != null}<span class="back">terug {formatDuration(b)}</span
										>{/if}
									<span>{km(w.distanceKm)} km</span>
									{#if w.ratingAvg != null}<span>★ {w.ratingAvg.toLocaleString('nl-NL')}</span>{/if}
									<span class="kind">{COLLECTION_LABELS[w.collection]}</span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
				{#if listed < visible.length}
					<!-- Keyed on the count, so the observer starts afresh after each page: if the button is
					     still in reach, it loads the next one too. -->
					{#key listed}
						<button
							type="button"
							class="more"
							onclick={() => (listed += PAGE_SIZE)}
							{@attach loadWhenNear}
						>
							Toon meer ({visible.length - listed})
						</button>
					{/key}
				{/if}
			{:else}
				<p class="hint">Geen wandelingen binnen deze filters. Verruim de reistijd of afstand.</p>
			{/if}
		{/if}
	</aside>
</div>

<style>
	.app {
		display: grid;
		/* minmax(0, …): an auto column grows to its widest child's min-content, and with the phone's
		   text size turned up that dragged the whole page, bar and map included, past the screen. */
		grid-template-columns: minmax(0, 1fr);
		min-height: 100vh;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 20px;
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}

	/* With big phone text the bar can't hold it all: the family site's name gives way, the app's doesn't. */
	.brand {
		display: flex;
		align-items: baseline;
		min-width: 0;
		margin: 0;
		font-size: var(--step-0);
		font-weight: 400;
		white-space: nowrap;
	}

	.brand a {
		color: inherit;
		text-decoration: none;
	}

	.brand .up {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--muted);
	}

	.theme-toggle {
		flex: none;
	}

	.brand .up:hover {
		color: var(--ink);
	}

	.brand .sep {
		margin: 0 0.45em;
		color: var(--muted);
	}

	.brand .here {
		font-weight: 700;
	}

	/* Small screens: bar and map stay put and the list slides over them, like a bottom sheet. The
	   map reaches down to a strip of list, so pulling the list down (see sheetRest) shows more of it.
	   svh, not vh: the map shouldn't resize as the phone's address bar comes and goes. */
	.head {
		position: sticky;
		top: 0;
		z-index: 0;
		display: flex;
		flex-direction: column;
		height: calc(100svh - 7.5rem);
	}

	.map-area {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	/* At least a screen tall, so even a short list can be pushed all the way up over the map. */
	.panel {
		position: relative;
		z-index: 1;
		min-height: 100svh;
		background: var(--surface);
		box-shadow: 0 -4px 12px var(--shadow);
	}

	@media (min-width: 800px) {
		.app {
			display: block;
			height: 100vh;
		}

		.head {
			display: contents;
		}

		.map-area {
			overflow: visible;
		}

		.panel {
			min-height: 0;
		}

		.map-area {
			position: fixed;
			inset: 0;
			height: auto;
		}

		/* The top bar caps the floating panel: one card, bar above, list or detail below. */
		.topbar {
			position: fixed;
			z-index: 2;
			top: 12px;
			left: 12px;
			width: var(--panel-width);
			height: 48px;
			border-radius: 10px 10px 0 0;
		}

		.panel {
			position: fixed;
			top: 60px;
			left: 12px;
			bottom: 12px;
			width: var(--panel-width);
			overflow-y: auto;
			border-radius: 0 0 10px 10px;
			box-shadow:
				0 1px 2px var(--shadow),
				0 8px 24px var(--shadow);
		}
	}

	.intro {
		padding: 18px 20px 6px;
	}

	.intro h1 {
		margin: 0 0 12px;
		font-size: var(--step-1);
		line-height: 1.25;
	}

	.count a {
		color: inherit;
	}

	.route-pick {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 10px;
		margin: 8px 20px 4px;
		color: var(--muted);
		font-size: var(--step--1);
	}

	/* As big as the filters bar under it: on a phone it's tapped. */
	.route-pick select {
		min-width: 0;
		padding: 7px 8px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
	}

	.filters {
		display: grid;
		gap: 8px;
		padding: 12px 20px;
		border-bottom: 1px solid var(--line);
		font-size: var(--step--1);
	}

	.filters > label,
	.filters > .row {
		display: grid;
		grid-template-columns: minmax(0, 8.5rem) minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
		color: var(--muted);
	}

	/* Wide enough for "12–18 km", so a slider doesn't shrink under your thumb as its value changes. */
	.filters output {
		min-width: 3.75rem;
		color: var(--ink);
		font-weight: 600;
		text-align: right;
	}

	/* A range input is ~130px wide unless told otherwise; let it take whatever the row leaves. */
	.filters input[type='range'] {
		width: 100%;
		min-width: 0;
		margin: 0;
		accent-color: var(--rail);
	}

	.filters-toggle {
		display: none;
	}

	/* Small screens: the filters fold away behind a bar that shows the day and how many filters bite. */
	@media (max-width: 799px) {
		.filters-toggle {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 12px;
			width: calc(100% - 40px);
			margin: 8px 20px 4px;
			padding: 8px 12px;
			border: 1px solid var(--line);
			border-radius: var(--radius);
			background: var(--surface);
			font-size: var(--step--1);
			cursor: pointer;
		}

		.toggle-label {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			font-weight: 600;
		}

		.toggle-label::after {
			content: '';
			width: 6px;
			height: 6px;
			margin: 0 2px 3px 2px;
			border: solid currentColor;
			border-width: 0 1.5px 1.5px 0;
			transform: rotate(45deg);
		}

		.filters-toggle[aria-expanded='true'] .toggle-label::after {
			margin-bottom: -3px;
			transform: rotate(-135deg);
		}

		.badge {
			min-width: 1.4em;
			padding: 0 5px;
			border-radius: 999px;
			background: var(--ink);
			color: var(--on-accent);
			font-size: 0.75rem;
			text-align: center;
			line-height: 1.5;
		}

		.filters:not(.open) {
			display: none;
		}

		/* Thumb-sized targets: the pills and checkboxes are tapped, not clicked. */
		.kinds button {
			padding: 6px 12px;
		}

		.checks label {
			padding: 4px 0;
		}
	}

	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.kinds button {
		padding: 3px 10px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--surface);
		color: var(--muted);
		cursor: pointer;
	}

	.kinds button[aria-pressed='true'] {
		border-color: var(--ink);
		background: var(--ink);
		color: var(--on-accent);
	}

	.kinds button span {
		opacity: 0.7;
		margin-left: 2px;
	}

	.kind {
		margin-left: auto;
		color: var(--muted);
	}

	.checks {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 16px;
	}

	.filters input.day,
	.sort select {
		grid-column: 2 / 4;
		min-width: 0;
		padding: 2px 4px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
	}

	/* The date takes the middle column; its weekday goes where the sliders show their value. */
	.filters input.day {
		grid-column: 2;
		color: var(--ink);
		font: inherit;
	}

	.count,
	.hint {
		margin: 10px 20px 4px;
		color: var(--muted);
		font-size: var(--step--1);
	}

	.notice {
		margin: 12px 20px 0;
		padding: 6px 9px;
		border-left: 3px solid var(--warn);
		background: var(--notice-bg);
		font-size: var(--step--1);
	}

	.walks {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.walks a {
		display: grid;
		width: 100%;
		padding: 10px 20px;
		border-bottom: 1px solid var(--line);
		color: inherit;
		text-decoration: none;
	}

	.walks a:hover {
		background: var(--paper);
	}

	.name {
		font-weight: 700;
	}

	.stations {
		color: var(--muted);
		font-size: var(--step--1);
	}

	.stations em {
		margin-left: 6px;
		font-style: normal;
		color: var(--warn);
	}

	.stations em.disrupted {
		font-weight: 700;
	}

	.stations em.done {
		color: var(--path);
	}

	.numbers {
		display: flex;
		flex-wrap: wrap;
		gap: 0 14px;
		margin-top: 2px;
		font-size: var(--step--1);
	}

	.travel {
		font-weight: 700;
	}

	.back {
		color: var(--muted);
	}

	.travel::before {
		content: '';
		display: inline-block;
		width: 14px;
		height: 6px;
		margin-right: 6px;
		vertical-align: middle;
		border-radius: 2px;
		background: var(--band-unknown);
	}

	/* The time stays in ink; the bar in front of it carries the map colour. */
	.band-near::before {
		background: var(--band-near);
	}
	.band-medium::before {
		background: var(--band-medium);
	}
	.band-far::before {
		background: var(--band-far);
	}
	.band-veryfar::before {
		background: var(--band-veryfar);
	}
	.band-unknown::before {
		background: var(--band-unknown);
	}

	.demo {
		margin: 4px 20px 8px;
		padding: 6px 9px;
		border-left: 3px solid var(--signal);
		font-size: var(--step--1);
	}
	.more {
		display: block;
		margin: 12px auto 0;
		padding: 6px 14px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--surface);
		color: var(--ink);
		font-size: var(--step--1);
		cursor: pointer;
	}

	.bar-actions {
		display: flex;
		flex: none;
		align-items: center;
		gap: 12px;
	}

	.sources-toggle {
		padding: 0;
		border: 0;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: var(--step--1);
		cursor: pointer;
	}
	.sources-toggle:hover {
		color: var(--ink);
	}

	/* Just under the bar, as wide as the panel. */
	.sources {
		inset: 68px auto auto 12px;
		width: min(var(--panel-width, 380px), calc(100vw - 24px));
		margin: 0;
		padding: 12px 16px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface);
		color: var(--ink);
		font-size: var(--step--1);
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
	}
	.sources p {
		margin: 0;
	}
</style>
