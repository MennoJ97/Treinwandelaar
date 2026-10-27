<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<!-- Files with a URL of their own (static/), not an inlined data: URI, so a search engine can
	     fetch the icon to show in its results. Keep these URLs stable, and keep them on Authentik's
	     Unauthenticated Paths: ^/favicon\.svg$ ^/favicon\.png$ ^/apple-touch-icon\.png$ -->
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<link rel="icon" type="image/png" sizes="192x192" href="/favicon.png" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</svelte:head>

{@render children()}

<style>
	/*
	  Greys, type and the light/dark switch come from the family site's family.css (FAMILY_SITE,
	  linked in app.html), like on every site of that family; the fallbacks below stand in without it. This file only names them the way the components do
	  and adds what is specific to this app: the rail colour of the journey diagram, the
	  travel-time ramp on the map and the map's own colours. Dark values use the family's pair of
	  selectors, so keep the two blocks identical.
	*/
	:global(:root) {
		--paper: var(--bg);
		--line: var(--rule);
		/* NS yellow, as NS uses it: a fill, never text. Walking (the route, the timetable's walk),
		   what's yours and what's on (pressed buttons, tags, sliders): outlined dark where it's a
		   line on the page. */
		--signal: var(--treinwandelaar, #ffc917);
		/* On the yellow (the day's route, its buttons): dark in both themes, as the yellow stays. */
		--on-signal: #111111;

		--rail: #1f3a93;
		/* The whole LAW routes and streekpaden on the map, and the one you plan on. */
		--path: #2e7a4c;
		--warn: #a14a12;
		/* The open walk's trains and buses on the map: grey, the basemap's own colour for railways,
		   so they stay in the background of the routes. */
		--transit: var(--muted);

		/* Travel time is a magnitude: one hue (blue, the train), strongest for walks close by and
		   fading with distance, so what's near stands out. Validated as an ordinal ramp (monotone
		   lightness, visible steps, lightest step >= 2:1 on the map). Grey: no train time. */
		--band-near: #104281;
		--band-medium: #256abf;
		--band-far: #5598e7;
		--band-veryfar: #86b6ef;
		--band-unknown: #8f8f8b;

		--on-accent: #ffffff;
		--notice-bg: #fbf1ea;
		--shadow: rgb(0 0 0 / 0.12);
		--map-casing: #ffffff;
		/* The other walks while you follow yourself on one: a trace, a shade off the basemap. */
		--map-faded: #d2d2ce;
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
			--path: #7fa98c;
			--warn: #ee9a5c;
			/* Flipped for the dark map: near is brightest, far sinks toward the background. */
			--band-near: #b7d3f6;
			--band-medium: #6da7ec;
			--band-far: #3987e5;
			--band-veryfar: #1c5cab;
			--band-unknown: #6b6b67;
			--on-accent: #161616;
			--notice-bg: #2a221c;
			--shadow: rgb(0 0 0 / 0.5);
			--map-casing: #1e1e1e;
			--map-faded: #333331;
			--map-style: 'dark';
		}
	}

	:global(:root[data-theme='dark']) {
		--rail: #7fa0ee;
		--path: #7fa98c;
		--warn: #ee9a5c;
		/* Flipped for the dark map: near is brightest, far sinks toward the background. */
		--band-near: #b7d3f6;
		--band-medium: #6da7ec;
		--band-far: #3987e5;
		--band-veryfar: #1c5cab;
		--band-unknown: #6b6b67;
		--on-accent: #161616;
		--notice-bg: #2a221c;
		--shadow: rgb(0 0 0 / 0.5);
		--map-casing: #1e1e1e;
		--map-faded: #333331;
		--map-style: 'dark';
	}

	/* Ticked boxes in the theme's yellow; the browser picks a tick that shows on it. */
	:global(input[type='checkbox']) {
		accent-color: var(--signal);
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

	/* Opened, the attribution is a popover over the legend, which otherwise sits just above it. */
	:global(.maplibregl-ctrl-bottom-right:has(.maplibregl-compact-show)) {
		z-index: 3;
	}

	:global(.maplibregl-ctrl-group button + button) {
		border-top-color: var(--line) !important;
	}

	/* Light glyphs on the dark surface. The hue-rotate undoes invert's colour flip, so the locate
	   button's blue "found you" state stays blue rather than turning orange. */
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light']) .maplibregl-ctrl button .maplibregl-ctrl-icon) {
			filter: invert(1) hue-rotate(180deg);
		}
	}

	:global(:root[data-theme='dark'] .maplibregl-ctrl button .maplibregl-ctrl-icon) {
		filter: invert(1) hue-rotate(180deg);
	}

	/* Without FAMILY_SITE: the family's tokens, at zero specificity so family.css wins when it's there. */
	:global(:where(:root)) {
		--font: 'Helvetica Neue', Helvetica, Arial, sans-serif;
		--bg: #f5f5f3;
		--surface: #ffffff;
		--ink: #111111;
		--muted: #666663;
		--rule: #d6d6d2;
		--accent: var(--ink);
		color-scheme: light dark;
	}

	@media (prefers-color-scheme: dark) {
		:global(:where(:root)) {
			--bg: #161616;
			--surface: #1e1e1e;
			--ink: #ecece9;
			--muted: #9c9c98;
			--rule: #2f2f2f;
		}
	}

	:global(:where(body)) {
		background: var(--bg);
		color: var(--ink);
		font-family: var(--font);
	}

	:global(:where(.mark)) {
		display: inline-block;
		height: 1.35em;
		width: auto;
		vertical-align: -0.3em;
		margin-right: 0.4em;
		overflow: visible;
	}

	:global(:where(.num)) {
		font-variant-numeric: tabular-nums;
	}

	:global(:where(:focus-visible)) {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
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
