<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={favicon} />
	<title>treinwandelaar</title>
</svelte:head>

{@render children()}

<style>
	/*
	  Greys, type and the light/dark switch come from https://mhjansen.nl/family.css (linked in
	  app.html), like every mhjansen.nl site. This file only names them the way the components do
	  and adds what is specific to this app: the rail/footpath colours of the journey diagram, the
	  travel-time ramp on the map and the map's own colours. Dark values use the family's pair of
	  selectors, so keep the two blocks identical.
	*/
	:global(:root) {
		--paper: var(--bg);
		--line: var(--rule);
		/* NS yellow, as NS uses it: a fill (logo tile, home station, your rating), never text. */
		--signal: var(--treinwandelaar, #ffc917);

		--rail: #1f3a93;
		--path: #2e7a4c;
		--warn: #a14a12;

		/* Travel-time bands: an ordered ramp that avoids green, which means "walking" here. */
		--band-near: #2a62c9;
		--band-medium: #6b45b0;
		--band-far: #c03f78;
		--band-veryfar: #e07b39;
		--band-unknown: #4d4d4a;

		--on-accent: #ffffff;
		--notice-bg: #fbf1ea;
		--shadow: rgb(0 0 0 / 0.12);
		--map-casing: #ffffff;
		--map-style: 'positron';

		--step--1: 0.8125rem;
		--step-0: 0.9375rem;
		--step-1: 1.125rem;
		--step-2: 1.5rem;
		--radius: 6px;
		--panel-width: 400px;
	}

	/* Every text colour here clears WCAG AA on the family's dark --bg, --surface and --notice-bg. */
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) {
			--rail: #7fa0ee;
			--path: #5dbb84;
			--warn: #ee9a5c;
			--band-near: #6e9bf0;
			--band-medium: #a98cec;
			--band-far: #ee7baf;
			--band-veryfar: #f2a064;
			--band-unknown: #a8a8a4;
			--on-accent: #161616;
			--notice-bg: #2a221c;
			--shadow: rgb(0 0 0 / 0.5);
			--map-casing: #1e1e1e;
			--map-style: 'dark';
		}
	}

	:global(:root[data-theme='dark']) {
		--rail: #7fa0ee;
		--path: #5dbb84;
		--warn: #ee9a5c;
		--band-near: #6e9bf0;
		--band-medium: #a98cec;
		--band-far: #ee7baf;
		--band-veryfar: #f2a064;
		--band-unknown: #a8a8a4;
		--on-accent: #161616;
		--notice-bg: #2a221c;
		--shadow: rgb(0 0 0 / 0.5);
		--map-casing: #1e1e1e;
		--map-style: 'dark';
	}

	/* MapLibre's own controls are white boxes with black glyphs; follow the theme instead. */
	:global(.maplibregl-ctrl-group),
	:global(.maplibregl-ctrl-attrib) {
		background: var(--surface) !important;
		color: var(--muted);
	}

	:global(.maplibregl-ctrl-attrib a) {
		color: var(--muted) !important;
	}

	:global(.maplibregl-ctrl-group button + button) {
		border-top-color: var(--line) !important;
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .maplibregl-ctrl button .maplibregl-ctrl-icon) {
			filter: invert(1);
		}
	}

	:global(:root[data-theme='dark'] .maplibregl-ctrl button .maplibregl-ctrl-icon) {
		filter: invert(1);
	}

	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}

	/* family.css sets background, colour and font on body; size and rhythm are ours. */
	:global(body) {
		margin: 0;
		font-size: var(--step-0);
		line-height: 1.45;
	}

	:global(button, input, select, textarea) {
		font: inherit;
		color: inherit;
	}

	:global(.tabular) {
		font-variant-numeric: tabular-nums;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(*) {
			transition: none !important;
			animation: none !important;
			scroll-behavior: auto !important;
		}
	}
</style>
