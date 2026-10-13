<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import WalkMap from '#lib/components/WalkMap.svelte';
	import WalkDetail from '#lib/components/WalkDetail.svelte';
	import Mark from '#lib/components/Mark.svelte';
	import StationPicker from '#lib/components/StationPicker.svelte';
	import { formatDuration, travelBand } from '#lib/itinerary.js';
	import {
		COLLECTION_LABELS,
		type Collection,
		type Reachability,
		type WalkSummary
	} from '#lib/types.js';
	import { endLabel, needsBus, startLabel } from '#lib/walk.js';
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

	// --- Travel times from home ---------------------------------------------------------------------
	let reachability = $state<Reachability>({});
	let reachStatus = $state<'idle' | 'loading' | 'error' | 'incomplete'>('idle');

	$effect(() => {
		if (!data.hasNsKey) return;
		const controller = new AbortController();
		// Drop the previous home's times at once: showing them under the new station is worse than "–".
		reachability = {};
		reachStatus = 'loading';
		fetch(`/api/reachability?from=${encodeURIComponent(home)}`, { signal: controller.signal })
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((r: { times: Reachability; incomplete: boolean }) => {
				reachability = r.times;
				reachStatus = r.incomplete ? 'incomplete' : 'idle';
			})
			.catch(() => {
				if (!controller.signal.aborted) reachStatus = 'error';
			});
		return () => controller.abort();
	});

	const minutesTo = (w: WalkSummary) =>
		w.startStation ? reachability[w.startStation]?.minutes : undefined;

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
	let sort = $state<'travel' | 'rating' | 'distance' | 'name'>(data.hasNsKey ? 'travel' : 'rating');

	const visible = $derived.by(() => {
		const list = data.walks.filter((w) => {
			const t = minutesTo(w);
			if (maxTravel < 180 && t != null && t > maxTravel) return false;
			if (maxKm < 25 && w.distanceKm > maxKm) return false;
			if (!shown.includes(w.collection)) return false;
			if (hideDone && w.status === 'done') return false;
			if (noBus && needsBus(w)) return false;
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
			onselect={select}
		/>
	</div>

	<aside class="panel" bind:this={panel}>
		{#if data.selected && homeStation}
			{#key data.selected.id}
				<WalkDetail
					walk={data.selected}
					home={homeStation}
					hasNsKey={data.hasNsKey}
					onclose={() => select(null)}
				/>
			{/key}
		{:else}
			<header class="intro">
				<StationPicker stations={data.stations} bind:value={home} label="Ik vertrek vanaf" />
			</header>

			<div class="filters">
				{#if data.hasNsKey}
					<label>
						<span>Max. reistijd heen</span>
						<input type="range" min="30" max="180" step="15" bind:value={maxTravel} />
						<output class="tabular">{maxTravel >= 180 ? 'alles' : formatDuration(maxTravel)}</output
						>
					</label>
				{/if}
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
					<label><input type="checkbox" bind:checked={hideDone} /> Verberg gelopen</label>
					<label><input type="checkbox" bind:checked={noBus} /> Alleen station tot station</label>
				</div>
				<label class="sort">
					<span>Sorteer op</span>
					<select bind:value={sort}>
						{#if data.hasNsKey}<option value="travel">reistijd</option>{/if}
						<option value="rating">waardering</option>
						<option value="distance">afstand</option>
						<option value="name">naam</option>
					</select>
				</label>
			</div>

			{#if !data.hasNsKey}
				<p class="notice">
					Reistijden en treinen zijn uit. Zet een <code>NS_API_KEY</code> in <code>.env</code> (gratis
					via apiportal.ns.nl).
				</p>
			{:else if reachStatus === 'loading'}
				<p class="hint" role="status">
					Reistijden vanaf {homeStation?.name} berekenen… De eerste keer voor een station duurt dat even
					(NS-planner, ±10 seconden); daarna is het direct.
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
					{#each visible as w (w.id)}
						{@const t = minutesTo(w)}
						<li>
							<button type="button" onclick={() => select(w.id)}>
								<span class="name">{w.name}</span>
								<span class="stations">
									{startLabel(w)}
									{w.isLoop ? '(rondje)' : `naar ${endLabel(w)}`}
									{#if needsBus(w)}<em>met bus</em>{/if}
									{#if w.status === 'done'}<em class="done">gelopen</em>{/if}
								</span>
								<span class="numbers tabular">
									{#if data.hasNsKey}
										<span class="travel band-{travelBand(t)}"
											>{t != null ? formatDuration(t) : '–'}</span
										>
									{/if}
									<span>{km(w.distanceKm)} km</span>
									{#if w.ratingAvg != null}<span>★ {w.ratingAvg.toLocaleString('nl-NL')}</span>{/if}
									<span class="kind">{COLLECTION_LABELS[w.collection]}</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="hint">Geen wandelingen binnen deze filters. Verruim de reistijd of afstand.</p>
			{/if}

			{#if data.hasNsKey}
				<div class="legend" aria-label="Legenda reistijd">
					<span class="band-near">&lt; 30 min</span>
					<span class="band-medium">30–60</span>
					<span class="band-far">60–90</span>
					<span class="band-veryfar">&gt; 90 min</span>
				</div>
			{/if}
			<p class="credits">Routes: Wandelnet en NS. Alleen voor persoonlijk gebruik.</p>
		{/if}
	</aside>
</div>

<style>
	.app {
		display: grid;
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

	.brand {
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
		color: var(--muted);
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
		grid-template-columns: 8.5rem 1fr 3.2rem;
		align-items: center;
		gap: 8px;
		color: var(--muted);
	}

	.filters output {
		color: var(--ink);
		font-weight: 600;
		text-align: right;
	}

	.filters input[type='range'] {
		accent-color: var(--rail);
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

	.sort select {
		grid-column: 2 / 4;
		padding: 2px 4px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
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

	.stations em.done {
		color: var(--path);
	}

	.numbers {
		display: flex;
		gap: 14px;
		margin-top: 2px;
		font-size: var(--step--1);
	}

	.travel {
		font-weight: 700;
	}

	.travel::before,
	.legend span::before {
		content: '';
		display: inline-block;
		width: 10px;
		height: 4px;
		margin-right: 5px;
		vertical-align: middle;
		border-radius: 2px;
		background: currentColor;
	}

	.band-near {
		color: var(--band-near);
	}
	.band-medium {
		color: var(--band-medium);
	}
	.band-far {
		color: var(--band-far);
	}
	.band-veryfar {
		color: var(--band-veryfar);
	}
	.band-unknown {
		color: var(--band-unknown);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		padding: 12px 20px 0;
		font-size: var(--step--1);
	}

	.credits {
		margin: 12px 20px 20px;
		color: var(--muted);
		font-size: var(--step--1);
	}
</style>
