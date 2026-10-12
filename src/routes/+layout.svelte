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

		--font: 'Overpass Variable', system-ui, sans-serif;
		--step--1: 0.8125rem;
		--step-0: 0.9375rem;
		--step-1: 1.125rem;
		--step-2: 1.5rem;
		--radius: 6px;
		--panel-width: 400px;
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
