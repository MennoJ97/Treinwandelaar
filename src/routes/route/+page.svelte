<script lang="ts">
	import { page } from '$app/state';
	import PageBar from '#lib/components/PageBar.svelte';
	import { COLLECTION_LABELS, type Collection } from '#lib/types.js';
	import { formatKm, walkPath } from '#lib/walk.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const groups = $derived(
		(Object.keys(COLLECTION_LABELS) as Collection[])
			.map((c) => ({
				collection: c,
				walks: data.walks
					.filter((w) => w.collection === c)
					.sort((a, b) => a.name.localeCompare(b.name, 'nl'))
			}))
			.filter((g) => g.walks.length)
	);
	const title = 'Alle treinwandelingen: van station naar station';
	const description = $derived(
		`${data.walks.length} dagwandelingen in Nederland die bij een station beginnen en eindigen: ` +
			'LAW-routes, streekpaden en lokale wandelingen, met de trein heen en terug.'
	);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href="{page.url.origin}/route/" />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content="{page.url.origin}/route/" />
</svelte:head>

<div class="page">
	<PageBar />
	<main>
		<h1>Alle wandelingen</h1>
		<p class="lead">
			{description} Op <a href="/">de kaart</a> zie je hoe lang je vanaf jouw station onderweg bent.
		</p>
		<nav class="toc" aria-label="Soort wandeling">
			{#each groups as g (g.collection)}
				<a href="#{g.collection}">{COLLECTION_LABELS[g.collection]} ({g.walks.length})</a>
			{/each}
		</nav>
		{#each groups as g (g.collection)}
			<section id={g.collection}>
				<h2>{COLLECTION_LABELS[g.collection]}</h2>
				<ul>
					{#each g.walks as w (w.id)}
						<li>
							<a href={walkPath(w.id)}>{w.name}</a>
							<span
								>{w.isLoop
									? `rondje vanaf ${w.startStationName ?? w.startPlace}`
									: `${w.startStationName ?? w.startPlace} → ${w.endStationName ?? w.endPlace}`},
								{formatKm(w.distanceKm)} km</span
							>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</main>
</div>

<style>
	main {
		max-width: 44rem;
		margin: 0 auto;
		padding: 24px 20px 48px;
	}

	h1 {
		margin: 0 0 8px;
		font-size: var(--step-2);
	}

	h2 {
		margin: 32px 0 8px;
		font-size: var(--step-1);
	}

	.lead {
		margin: 0;
	}

	a {
		color: inherit;
	}

	.toc {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 16px;
		margin: 16px 0 0;
		font-size: var(--step--1);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	li {
		padding: 4px 0;
		border-bottom: 1px solid var(--line);
	}

	li span {
		margin-left: 6px;
		color: var(--muted);
		font-size: var(--step--1);
	}
</style>
