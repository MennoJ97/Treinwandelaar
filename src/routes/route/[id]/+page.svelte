<script lang="ts">
	import { page } from '$app/state';
	import PageBar from '#lib/components/PageBar.svelte';
	import { track } from '#lib/track.js';
	import {
		AT_STATION_M,
		COLLECTION_LABELS,
		WALKABLE_STATION_M,
		type WalkListItem
	} from '#lib/types.js';
	import {
		alongSentences,
		formatKm,
		osmCredit,
		walkDescription,
		walkHeading,
		walkNetwork,
		walkPath,
		walkTitle,
		wandelnetCredit,
		WANDELNET_MELDPUNT
	} from '#lib/walk.js';
	import type { StageLink } from '#lib/server/walks.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const walk = $derived(data.walk);
	const title = $derived(walkTitle(walk));
	const description = $derived(walkDescription(walk, walk.along));
	const heading = $derived(walkHeading(walk));
	const along = $derived(alongSentences(walk, walk.along));
	const cardAlt = $derived(
		`Route van ${heading}, ${formatKm(walk.distanceKm)} km, ` +
			(walk.isLoop
				? `rondje vanaf station ${walk.startStationName ?? walk.startPlace}`
				: `van station ${walk.startStationName ?? walk.startPlace} naar station ${walk.endStationName ?? walk.endPlace}`)
	);
	const canonical = $derived(page.url.origin + walkPath(walk.id));
	/** Search engines see what an anonymous visitor sees; a signed-in user's Wandelnet walk is not for them. */
	const indexable = $derived(walk.source === 'osm');
	const home = $derived(`/?walk=${encodeURIComponent(walk.id)}`);

	/** "station Breda", and how far the route's own end is from it (straight line), or that it takes a bus. */
	function access(
		station: string | null,
		place: string | null,
		metres: number | null,
		end: 'begin' | 'eind'
	) {
		if (!station) return place ?? '?';
		if (metres == null || metres <= AT_STATION_M) return `station ${station}`;
		const km = `${formatKm(Math.round(metres / 100) / 10)} km`;
		return metres > WALKABLE_STATION_M
			? `${place ?? `het ${end}`}, ${km} van station ${station}: met de bus`
			: `station ${station}, het ${end} van de route ligt ${km} verderop`;
	}

	/** A stretch planned on request has no page of its own: it opens on the map. */
	const stageHref = (w: StageLink) =>
		w.planned ? `/?walk=${encodeURIComponent(w.id)}` : walkPath(w.id);

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
	{#if data.card}
		<!-- Versioned: link previews keep a card by its URL. Without one, the site's card
		     (lib/template.ts) stands in. -->
		<meta property="og:image" content="{canonical}/og.png?v={data.card}" />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="630" />
		<meta property="og:image:alt" content={cardAlt} />
	{/if}
</svelte:head>

<div class="page">
	<PageBar />
	<main>
		<p class="kicker">{walkNetwork(walk) ?? COLLECTION_LABELS[walk.collection]}</p>
		<h1>{heading}</h1>
		<p class="lead">
			{walk.isLoop ? 'Rondwandeling' : 'Wandeling'} van {formatKm(walk.distanceKm)} km
			{#if walk.isLoop}vanaf station {walk.startStationName ?? walk.startPlace}{:else}van station
				{walk.startStationName ?? walk.startPlace} naar station {walk.endStationName ??
					walk.endPlace}{/if}, met de trein heen en terug.
		</p>

		<p class="actions">
			<a class="primary" href={home}>Op de kaart, met treinen vanaf jouw station</a>
			<a
				href="/api/walks/{encodeURIComponent(walk.id)}/gpx"
				onclick={() => track('gpx-download', { id: walk.id, reverse: false })}>GPX downloaden</a
			>
			<a
				href="/api/walks/{encodeURIComponent(walk.id)}/gpx?reverse=1"
				onclick={() => track('gpx-download', { id: walk.id, reverse: true })}>GPX andersom</a
			>
		</p>

		{#if data.related.prev || data.related.next}
			<nav class="stages" aria-label="Etappes">
				{#if data.related.prev}<a rel="prev" href={stageHref(data.related.prev)}
						>← Vorige etappe: {stationsLine(data.related.prev)}</a
					>{/if}
				{#if data.related.next}<a rel="next" href={stageHref(data.related.next)}
						>Volgende etappe: {stationsLine(data.related.next)} →</a
					>{/if}
			</nav>
		{/if}

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
			<dd>{access(walk.startStationName, walk.startPlace, walk.startStationM, 'begin')}</dd>
			{#if !walk.isLoop}
				<dt>Eind</dt>
				<dd>{access(walk.endStationName, walk.endPlace, walk.endStationM, 'eind')}</dd>
			{/if}
			{#if walk.pavedPct != null}
				<dt>Verhard</dt>
				<dd>{walk.pavedPct}%</dd>
			{/if}
			<dt>Soort</dt>
			<dd>{COLLECTION_LABELS[walk.collection]}</dd>
			{#if heading !== walk.name}
				<dt>In OpenStreetMap</dt>
				<dd>{walk.name}</dd>
			{/if}
		</dl>

		{#if along.length}
			<section>
				<h2>Onderweg</h2>
				<p class="along">{along.join(' ')}</p>
			</section>
		{/if}

		{#if walk.description}<p class="description">{walk.description}</p>{/if}

		{#if data.related.stages.length && data.related.path}
			<section>
				<h2>Alle etappes van het {data.related.path.name}</h2>
				<ul class="related">
					{#each data.related.stages as w (w.id)}
						<li>
							<a href={walkPath(w.id)}>{walkHeading(w)}</a>
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
							<a href={walkPath(w.id)}>{walkHeading(w)}</a>
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

	.along {
		margin: 0;
	}

	.stages {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 8px 20px;
		margin: 0 0 20px;
		font-size: var(--step--1);
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
