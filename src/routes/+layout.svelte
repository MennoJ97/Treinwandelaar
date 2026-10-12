<script lang="ts">
	import '@fontsource-variable/overpass';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Treinwandelaar</title>
</svelte:head>

{@render children()}

<style>
	:global(:root) {
		--paper: #f4f6f5;
		--surface: #ffffff;
		--ink: #17222b;
		--muted: #5e6a73;
		--line: #d9dfe2;
		--rail: #1f3a93;
		--path: #2e7a4c;
		--signal: #f2b705;
		--warn: #a14a12;

		/* Travel-time bands: an ordered ramp that avoids green, which means "walking" here. */
		--band-near: #2a62c9;
		--band-medium: #6b45b0;
		--band-far: #c03f78;
		--band-veryfar: #e07b39;
		--band-unknown: #3f5361;

		/* Text on a filled accent (selected train, pressed buttons), the warning callout,
		   and the map's own colours that MapLibre needs as plain values. */
		--on-accent: #ffffff;
		--notice-bg: #fbf1ea;
		--shadow: rgb(23 34 43 / 0.12);
		--map-casing: #ffffff;
		--map-style: 'positron';

		--font: 'Overpass Variable', system-ui, sans-serif;
		--step--1: 0.8125rem;
		--step-0: 0.9375rem;
		--step-1: 1.125rem;
		--step-2: 1.5rem;
		--radius: 6px;
		--panel-width: 400px;
	}

	/* Dark follows the system unless the switch (static/family.js) set data-theme on <html>.
	   A media query and an attribute selector can't share one rule, so the palette is written
	   twice, as on the other mhjansen.nl sites: keep the two blocks identical. The greys are the
	   family's pure ones; every text colour clears WCAG AA on --paper, --surface and --notice-bg. */
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) {
			--paper: #161616;
			--surface: #1e1e1e;
			--ink: #ecece9;
			--muted: #9c9c98;
			--line: #2f2f2f;
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
		--paper: #161616;
		--surface: #1e1e1e;
		--ink: #ecece9;
		--muted: #9c9c98;
		--line: #2f2f2f;
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

	:global(:root[data-theme='light']) {
		color-scheme: light;
	}

	:global(:root[data-theme='dark']) {
		color-scheme: dark;
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

	/* The family's switch icon: the contrast circle, turned over while dark is showing. */
	:global(.theme-toggle[hidden]) {
		display: none !important;
	}

	:global(.theme-toggle svg) {
		width: 16px;
		height: 16px;
		transition: transform 0.2s;
	}

	:global(.theme-toggle[data-showing='dark'] svg) {
		transform: rotate(180deg);
	}

	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		background: var(--paper);
		color: var(--ink);
		font-family: var(--font);
		font-size: var(--step-0);
		line-height: 1.45;
		-webkit-font-smoothing: antialiased;
	}

	:global(button, input, select, textarea) {
		font: inherit;
		color: inherit;
	}

	:global(:focus-visible) {
		outline: 2px solid var(--rail);
		outline-offset: 2px;
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
