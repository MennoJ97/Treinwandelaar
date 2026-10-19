<script lang="ts">
	import { page } from '$app/state';
	import PageBar from '#lib/components/PageBar.svelte';
	import {
		AT_STATION_M,
		COLLECTION_LABELS,
		WALKABLE_STATION_M,
		type WalkListItem
	} from '#lib/types.js';
	import {
		formatKm,
		osmCredit,
		walkDescription,
		walkPath,
		walkTitle,
		wandelnetCredit,
		WANDELNET_MELDPUNT
	} from '#lib/walk.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const walk = $derived(data.walk);
	const title = $derived(walkTitle(walk));
	const description = $derived(walkDescription(walk));
	const canonical = $derived(page.url.origin + walkPath(walk.id));
	/** Search engines see what an anonymous visitor sees; a signed-in user's Wandelnet walk is not for them. */
	const indexable = $derived(walk.source === 'osm');
	const home = $derived(`/?walk=${encodeURIComponent(walk.id)}`);

	/** "station Breda", and how far the route's own end is from it (straight line), or that it takes a bus. */
	function access(station: string | null, place: string | null, metres: number | null) {
		if (!station) return place ?? '?';
		if (metres == null || metres <= AT_STATION_M) return `station ${station}`;
		const km = `${formatKm(Math.round(metres / 100) / 10)} km`;
		return metres > WALKABLE_STATION_M
			? `${place ?? 'het begin'}, ${km} van station ${station}: met de bus`
			: `station ${station}, het begin van de route ligt ${km} verderop`;
	}

	const stationsLine = (w: WalkListItem) =>
		w.isLoop
			? `rondje vanaf ${w.startStationName ?? w.startPlace}`
			: `${w.startStationName ?? w.startPlace} → ${w.endStationName ?? w.endPlace}`;
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />
	{#if !indexable}<meta name="robots" content="noindex" />{/if}
	<meta property="og:type" content="website" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
</svelte:head>

<div class="page">
	<PageBar />
	<main>
		<p class="kicker">{COLLECTION_LABELS[walk.collection]}</p>
		<h1>{walk.name}</h1>
		<p class="lead">
			{walk.isLoop ? 'Rondwandeling' : 'Wandeling'} van {formatKm(walk.distanceKm)} km
			{#if walk.isLoop}vanaf station {walk.startStationName ?? walk.startPlace}{:else}van station
				{walk.startStationName ?? walk.startPlace} naar station {walk.endStationName ??
					walk.endPlace}{/if}, met de trein heen en terug.
		</p>

		<p class="actions">
			<a class="primary" href={home}>Op de kaart, met treinen vanaf jouw station</a>
			<a href="/api/walks/{encodeURIComponent(walk.id)}/gpx">GPX downloaden</a>
		</p>

		{#if data.sketch}
			{@const s = data.sketch}
			<svg
				class="sketch"
				viewBox="0 0 {s.width} {s.height}"
				role="img"
				aria-label="Vorm van de route, noorden boven"
			>
				<path d={s.d} />
				<circle class="start" cx={s.start[0]} cy={s.start[1]} r="6" />
				{#if !walk.isLoop}<circle class="end" cx={s.end[0]} cy={s.end[1]} r="6" />{/if}
			</svg>
		{/if}

		<dl class="facts">
			<dt>Afstand</dt>
			<dd>{formatKm(walk.distanceKm)} km</dd>
			<dt>{walk.isLoop ? 'Start en eind' : 'Start'}</dt>
			<dd>{access(walk.startStationName, walk.startPlace, walk.startStationM)}</dd>
			{#if !walk.isLoop}
				<dt>Eind</dt>
				<dd>{access(walk.endStationName, walk.endPlace, walk.endStationM)}</dd>
			{/if}
			{#if walk.pavedPct != null}
				<dt>Verhard</dt>
				<dd>{walk.pavedPct}%</dd>
			{/if}
			<dt>Soort</dt>
			<dd>{COLLECTION_LABELS[walk.collection]}</dd>
		</dl>

		{#if walk.description}<p class="description">{walk.description}</p>{/if}

		{#if data.related.stages.length && data.related.path}
			<section>
				<h2>Meer etappes van het {data.related.path.name}</h2>
				<ul class="related">
					{#each data.related.stages as w (w.id)}
						<li>
							<a href={walkPath(w.id)}>{w.name}</a>
							<span>{stationsLine(w)}, {formatKm(w.distanceKm)} km</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if data.related.nearby.length}
			<section>
				<h2>Meer wandelingen vanaf deze stations</h2>
				<ul class="related">
					{#each data.related.nearby as w (w.id)}
						<li>
							<a href={walkPath(w.id)}>{w.name}</a>
							<span>{stationsLine(w)}, {formatKm(w.distanceKm)} km</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<p class="more"><a href="/route/">Alle wandelingen</a></p>

		<footer>
			{#if walk.source === 'osm'}
				{osmCredit(data.updated)}.
				<a href={walk.sourceUrl} rel="noreferrer">Deze route op OpenStreetMap</a>.
			{:else}
				{wandelnetCredit(data.updated)}. Alleen voor persoonlijk gebruik.
				<a href={walk.sourceUrl} rel="noreferrer">Deze route bij Wandelnet</a>,
				<a href={WANDELNET_MELDPUNT} rel="noreferrer">meld een probleem</a>.
			{/if}
		</footer>
	</main>
</div>

<style>
	main {
		max-width: 44rem;
		margin: 0 auto;
		padding: 24px 20px 48px;
	}

	.kicker {
		margin: 0;
		color: var(--muted);
		font-size: var(--step--1);
	}

	h1 {
		margin: 4px 0 8px;
		font-size: var(--step-2);
		line-height: 1.2;
	}

	h2 {
		margin: 32px 0 8px;
		font-size: var(--step-1);
	}

	.lead {
		margin: 0;
		font-size: var(--step-1);
	}

	a {
		color: inherit;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 20px;
		align-items: center;
		margin: 20px 0;
	}

	.actions .primary {
		padding: 8px 14px;
		border-radius: var(--radius);
		background: var(--ink);
		color: var(--bg);
		text-decoration: none;
		font-weight: 700;
	}

	.sketch {
		display: block;
		width: 100%;
		max-height: 22rem;
		margin: 8px 0 20px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}

	.sketch path {
		fill: none;
		stroke: var(--path);
		stroke-width: 3;
		stroke-linejoin: round;
		stroke-linecap: round;
		vector-effect: non-scaling-stroke;
	}

	.sketch circle {
		stroke: var(--surface);
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
	}

	.sketch .start {
		fill: var(--rail);
	}

	.sketch .end {
		fill: var(--ink);
	}

	.facts {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 4px 16px;
		margin: 0;
	}

	.facts dt {
		color: var(--muted);
	}

	.facts dd {
		margin: 0;
	}

	.description {
		margin: 20px 0 0;
	}

	.related {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.related li {
		padding: 6px 0;
		border-bottom: 1px solid var(--line);
	}

	.related span {
		display: block;
		color: var(--muted);
		font-size: var(--step--1);
	}

	.more {
		margin: 24px 0 0;
	}

	footer {
		margin-top: 32px;
		color: var(--muted);
		font-size: var(--step--1);
	}
</style>
