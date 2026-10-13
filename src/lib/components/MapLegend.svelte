<!--
  The key to the map's colours: travel time from home, as a stepped colour bar. Text stays in ink;
  only the swatches carry the colour, so the labels read the same in both themes.
-->
<script lang="ts">
	interface Props {
		homeName: string;
		dayLabel: string;
		loading: boolean;
	}

	let { homeName, dayLabel, loading }: Props = $props();

	const steps = [
		{ band: 'near', label: '< 30' },
		{ band: 'medium', label: '30–60' },
		{ band: 'far', label: '60–90' },
		{ band: 'veryfar', label: '> 90 min' }
	];
</script>

<figure class="legend" aria-label="Legenda: reistijd met de trein">
	<figcaption>
		Reistijd vanaf <strong>{homeName}</strong>
		<span class="day">{loading ? 'berekenen…' : dayLabel}</span>
	</figcaption>
	<div class="bar" aria-hidden="true">
		{#each steps as s (s.band)}<span style="background: var(--band-{s.band})"></span>{/each}
	</div>
	<ol class="ticks">
		{#each steps as s (s.band)}<li>{s.label}</li>{/each}
	</ol>
	<p class="none"><span class="swatch" aria-hidden="true"></span>geen trein</p>
</figure>

<style>
	.legend {
		position: absolute;
		z-index: 2;
		right: 10px;
		bottom: 30px; /* clear of the attribution */
		width: 236px;
		margin: 0;
		padding: 9px 11px 8px;
		background: var(--surface);
		border-radius: 8px;
		box-shadow:
			0 1px 2px var(--shadow),
			0 4px 14px var(--shadow);
		font-size: var(--step--1);
		line-height: 1.3;
	}

	figcaption {
		margin-bottom: 7px;
		color: var(--ink);
	}

	.day {
		display: block;
		color: var(--muted);
	}

	.bar {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 2px; /* surface gap between fills */
		height: 10px;
	}

	.bar span:first-child {
		border-radius: 3px 0 0 3px;
	}

	.bar span:last-child {
		border-radius: 0 3px 3px 0;
	}

	.ticks {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		margin: 4px 0 0;
		padding: 0;
		list-style: none;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.ticks li:last-child {
		white-space: nowrap;
	}

	.none {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 6px 0 0;
		color: var(--muted);
	}

	.swatch {
		width: 18px;
		height: 4px;
		border-radius: 2px;
		background: var(--band-unknown);
	}

	/* Small screens: the map is a 45vh strip; keep the key compact in its corner. */
	@media (max-width: 799px) {
		.legend {
			left: 8px;
			right: auto;
			bottom: 24px;
			width: 200px;
			padding: 7px 9px 6px;
		}

		.none {
			display: none;
		}
	}
</style>
