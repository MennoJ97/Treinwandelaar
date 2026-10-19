<script lang="ts">
	import { FAMILY_SITE } from '$app/env/public';
	import Mark from './Mark.svelte';
</script>

<!-- The home page's bar for the plain pages (a walk's own page, the index of walks): "<family site> /
     treinwandelaar", then the family's light/dark switch, which family.js wires up on page load
     (those pages have no client-side routing, csr = false, so every page is a fresh load). -->
<header class="bar">
	<nav class="brand" aria-label="Site">
		{#if FAMILY_SITE}<a class="up" href={FAMILY_SITE}>{new URL(FAMILY_SITE).host}</a><span
				class="sep"
				aria-hidden="true">/</span
			>{/if}<a class="here" href="/"><Mark />treinwandelaar</a>
	</nav>
	<button class="theme-toggle" aria-label="Donkere modus" hidden></button>
</header>

<style>
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 20px;
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}

	.brand {
		display: flex;
		align-items: baseline;
		min-width: 0;
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

	.brand .up:hover {
		color: var(--ink);
	}

	.sep {
		margin: 0 0.45em;
		color: var(--muted);
	}

	.here {
		font-weight: 700;
	}

	.theme-toggle {
		flex: none;
	}
</style>
