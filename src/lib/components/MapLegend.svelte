<!--
  The key to the map's colours: travel time from home, as a stepped colour bar. Text stays in ink;
  only the swatches carry the colour, so the labels read the same in both themes.
-->
<script lang="ts">
	interface Props {
		homeName: string;
		dayLabel: string;
		loading: boolean;
		/** A walk is open: its trains and buses are on the map too. */
		transit?: boolean;
	}

	let { homeName, dayLabel, loading, transit = false }: Props = $props();

	const steps = [
		{ band: 'near', label: '< 30' },
		{ band: 'medium', label: '30–60' },
		{ band: 'far', label: '60–90' },
		{ band: 'veryfar', label: '> 90' }
	];
</script>

<figure class="legend" aria-label="Legenda: reistijd met de trein">
	<figcaption>
		<span
			>Reistijd<span class="from">{' '}vanaf <strong>{homeName}</strong></span><span
				class="unit-cap">(min)</span
			></span
		>
		<span class="day">{loading ? 'berekenen…' : dayLabel}</span>
	</figcaption>
	<div class="bar" aria-hidden="true">
		{#each steps as s (s.band)}<span style="background: var(--band-{s.band})"></span>{/each}
	</div>
	<ol class="ticks">
		{#each steps as s, i (s.band)}<li>
				{s.label}{#if i === steps.length - 1}<span class="unit"> min</span>{/if}
			</li>{/each}
	</ol>
	<p class="none"><span class="swatch" aria-hidden="true"></span>geen trein</p>
	{#if transit}
		<p class="transit">
			<span><span class="rail" aria-hidden="true"></span>trein</span>
			<span><span class="bus" aria-hidden="true"></span>bus</span>
		</p>
	{/if}
</figure>

<style>
	.legend {
		position: absolute;
		z-index: 2;
		right: 10px;
		bottom: 44px; /* stacked above the attribution's (i) button, 10px apart like the zoom controls */
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

	.unit-cap {
		display: none;
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

	/* The open walk's trains and buses, drawn as on the map: rails with sleepers, a dashed bus. */
	.transit {
		display: flex;
		gap: 14px;
		margin: 4px 0 0;
		color: var(--muted);
	}

	.transit > span {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.rail,
	.bus {
		width: 18px;
		height: 3px;
	}

	.rail {
		background: repeating-linear-gradient(
			90deg,
			var(--transit) 0 3px,
			color-mix(in srgb, var(--transit) 35%, var(--surface)) 3px 6px
		);
	}

	.bus {
		background: repeating-linear-gradient(90deg, var(--transit) 0 3px, transparent 3px 6px);
	}

	/* Small screens: the list covers the map's bottom and the station picker sits right under the
	   key, so it drops the station, keeps to one caption line, and rides on the list's top edge. */
	@media (max-width: 799px) {
		.legend {
			left: 8px;
			right: auto;
			bottom: 8px;
			transform: translateY(calc(-1 * var(--sheet-cover, 0px)));
			width: min(13.5rem, 62vw);
			padding: 6px 8px 5px;
			font-size: 0.75rem;
		}

		figcaption {
			display: flex;
			justify-content: space-between;
			gap: 8px;
			margin-bottom: 5px;
			white-space: nowrap;
		}

		/* "min" moves into the caption, so four ticks fit a narrow key. */
		.from,
		.unit,
		.none,
		.transit {
			display: none;
		}

		.unit-cap {
			display: inline;
			margin-left: 0.3em;
		}

		.day {
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.bar {
			height: 7px;
		}
	}
</style>
