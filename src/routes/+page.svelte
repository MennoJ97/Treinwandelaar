<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import WalkMap from '#lib/components/WalkMap.svelte';
	import WalkDetail from '#lib/components/WalkDetail.svelte';
	import Mark from '#lib/components/Mark.svelte';
	import StationPicker from '#lib/components/StationPicker.svelte';
	import MapLegend from '#lib/components/MapLegend.svelte';
	import { amsterdamYmd, formatDuration, nextSaturdayMorning, travelBand } from '#lib/itinerary.js';
	import {
		COLLECTION_LABELS,
		type Collection,
		type Disruption,
		type Reachability,
		type ReachabilityResponse,
		type WalkSummary
	} from '#lib/types.js';
	import {
		endLabel,
		needsBus,
		osmCredit,
		startLabel,
		WANDELNET_MELDPUNT,
		wandelnetCredit
	} from '#lib/walk.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

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
	let reachStatus = $state<'idle' | 'loading' | 'error' | 'incomplete'>('idle');

	$effect(() => {
		const controller = new AbortController();
		// Drop the previous home's times at once: showing them under the new station is worse than "–".
		reachability = {};
		reachBack = {};
		disruptions = {};
		closed = {};
		reachStatus = 'loading';
		const params = new URLSearchParams({ from: home, date: day });
		fetch(`/api/reachability?${params}`, { signal: controller.signal })
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((r: ReachabilityResponse) => {
				reachability = r.times;
				reachBack = r.back;
				disruptions = r.disruptions;
				closed = r.closed ?? {};
				reachSource = r.source;
				reachStatus = r.incomplete ? 'incomplete' : 'idle';
			})
			.catch(() => {
				if (!controller.signal.aborted) reachStatus = 'error';
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

	// --- Filters & sorting --------------------------------------------------------------------------
	let maxTravel = $state(180);
	let maxKm = $state(25);
	let hideDone = $state(false);
	const collections = Object.keys(COLLECTION_LABELS) as Collection[];
	let shown = $state<Collection[]>([...collections]);
	const countBy = $derived(
		Object.fromEntries(
			collections.map((c) => [c, data.walks.filter((w) => w.collection === c).length])
		) as Record<Collection, number>
	);

	function toggleCollection(c: Collection) {
		shown = shown.includes(c) ? shown.filter((x) => x !== c) : [...shown, c];
	}
	let noBus = $state(false);
	let hideDisrupted = $state(false);
	let sort = $state<'travel' | 'rating' | 'distance' | 'name'>('travel');

	/** Small screens fold the filters away so the list starts under the map; this says how many bite. */
	let filtersOpen = $state(false);
	const activeFilters = $derived(
		[
			maxTravel < 180,
			maxKm < 25,
			shown.length < collections.filter((c) => countBy[c]).length,
			hideDone,
			noBus,
			hideDisrupted
		].filter(Boolean).length
	);

	const visible = $derived.by(() => {
		const list = data.walks.filter((w) => {
			const t = minutesTo(w);
			if (maxTravel < 180 && t != null && t > maxTravel) return false;
			if (maxKm < 25 && w.distanceKm > maxKm) return false;
			if (!shown.includes(w.collection)) return false;
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

	// Switching between list and detail should start at the top, not the list's scroll position.
	$effect(() => {
		void selectedId;
		panel?.scrollTo({ top: 0 });
		window.scrollTo({ top: 0 }); // small screens scroll the page, not the panel
	});

	function select(id: string | null) {
		const url = new URL(page.url.href);
		if (id) url.searchParams.set('walk', id);
		else url.searchParams.delete('walk');
		goto(url, { reset: false });
	}

	const km = (n: number) => n.toLocaleString('nl-NL', { maximumFractionDigits: 1 });

	// The demo shows only OpenStreetMap walks; signed-in users get those Wandelnet doesn't cover.
	const hasOsm = $derived(data.walks.some((w) => w.source === 'osm'));
	const mapCredit = $derived(
		data.demo
			? osmCredit(data.osmUpdated)
			: wandelnetCredit(data.wandelnetUpdated) + (hasOsm ? '; andere routes © OpenStreetMap' : '')
	);
</script>

<div class="app">
	<!-- "mhjansen.nl / treinwandelaar", the same order as the nav on the other mhjansen.nl sites,
	     with the family's light/dark switch last. Outside the panel on purpose: family.js only wires
	     up switches that exist when the page loads, and the panel re-renders. -->
	<header class="topbar">
		<h1 class="brand">
			<a class="up" href="https://mhjansen.nl">mhjansen.nl</a><span class="sep" aria-hidden="true"
				>/</span
			><a class="here" href="/"><Mark />treinwandelaar</a>
		</h1>
		<button class="theme-toggle" aria-label="Donkere modus" hidden></button>
	</header>

	<div class="map-area">
		<WalkMap
			walks={visible}
			stations={data.stations}
			{home}
			{reachability}
			{selectedId}
			credit={mapCredit}
			onselect={select}
			onlocate={(code) => (home = code)}
		/>
		<MapLegend
			homeName={homeStation?.name ?? ''}
			dayLabel={dayLabel(day)}
			loading={reachStatus === 'loading'}
		/>
	</div>

	<aside class="panel" bind:this={panel}>
		{#if data.selected && homeStation}
			{#key data.selected.id}
				<WalkDetail
					walk={data.selected}
					home={homeStation}
					hasNsKey={data.hasNsKey}
					demo={data.demo}
					{day}
					disruptions={walkDisruptions(data.selected)}
					onclose={() => select(null)}
				/>
			{/key}
		{:else}
			<header class="intro">
				<StationPicker stations={data.stations} bind:value={home} label="Ik vertrek vanaf" />
			</header>
			{#if data.demo}
				<p class="demo">
					Demo met LAW-routes, streekpaden en lokale wandelingen uit OpenStreetMap.
					<a href="/login" data-sveltekit-reload>Inloggen</a> voor meer wandelingen en om bij te houden
					wat je wilt lopen.
				</p>
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
				<label>
					<span>Max. afstand</span>
					<input type="range" min="8" max="25" step="1" bind:value={maxKm} />
					<output class="tabular">{maxKm >= 25 ? 'alles' : `${maxKm} km`}</output>
				</label>
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
				<div class="checks">
					{#if !data.demo}
						<label><input type="checkbox" bind:checked={hideDone} /> Verberg gelopen</label>
					{/if}
					<label><input type="checkbox" bind:checked={noBus} /> Alleen station tot station</label>
					<label
						><input type="checkbox" bind:checked={hideDisrupted} /> Zonder werkzaamheden of storingen</label
					>
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
			{:else if reachStatus === 'error'}
				<p class="notice">
					Reistijden ophalen mislukt. De lijst werkt wel, alleen zonder reistijd.
				</p>
			{/if}

			<p class="count">{visible.length} van {data.walks.length} wandelingen</p>

			{#if visible.length}
				<ul class="walks">
					{#each listedWalks as w (w.id)}
						{@const t = minutesTo(w)}
						{@const hits = walkDisruptions(w)}
						{@const b = minutesBack(w)}
						<li>
							<button type="button" onclick={() => select(w.id)}>
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
							</button>
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

			<p class="credits">
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
		{/if}
	</aside>
</div>

<style>
	.app {
		display: grid;
		/* minmax(0, …): an auto column grows to its widest child's min-content, and with the phone's
		   text size turned up that dragged the whole page, bar and map included, past the screen. */
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto 45vh auto;
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

	/* With big phone text the bar can't hold it all: "mhjansen.nl" gives way, the app name doesn't. */
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

	/* Small screens: the map stays put and the list slides up over it, like a bottom sheet. */
	.map-area {
		position: sticky;
		top: 0;
		height: 45vh;
		z-index: 0;
	}

	.panel {
		position: relative;
		z-index: 1;
		background: var(--surface);
		box-shadow: 0 -4px 12px var(--shadow);
	}

	@media (min-width: 800px) {
		.app {
			display: block;
			height: 100vh;
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

	.filters {
		display: grid;
		gap: 8px;
		padding: 12px 20px;
		border-bottom: 1px solid var(--line);
		font-size: var(--step--1);
	}

	.filters > label {
		display: grid;
		grid-template-columns: minmax(0, 8.5rem) minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
		color: var(--muted);
	}

	.filters output {
		min-width: 3.2rem;
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

	.walks button {
		display: grid;
		width: 100%;
		padding: 10px 20px;
		border: 0;
		border-bottom: 1px solid var(--line);
		background: none;
		text-align: left;
		cursor: pointer;
	}

	.walks button:hover {
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

	.credits {
		margin: 12px 20px 20px;
		color: var(--muted);
		font-size: var(--step--1);
	}
</style>
