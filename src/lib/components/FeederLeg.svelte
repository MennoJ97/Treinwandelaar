<script lang="ts">
	import type { FeederRide } from '#lib/types.js';
	import { formatTime, minutesBetween } from '#lib/itinerary.js';

	interface Props {
		/** The rides you can still make, first one earliest; null while loading or when none. */
		rides: FeederRide[] | null;
		chosen: FeederRide | null;
		onselect: (ride: FeederRide) => void;
		/** Minutes on foot between the chosen ride's stop and the route. */
		stopMinutes: number;
		/** 'start': from the station to the route; 'end': from the route to the station. */
		side: 'start' | 'end';
	}

	let { rides, chosen, onselect, stopMinutes, side }: Props = $props();
</script>

{#if rides && chosen}
	<div class="options" role="radiogroup" aria-label="Kies een bus">
		{#each rides as ride (ride.departure + ride.line)}
			<button
				type="button"
				role="radio"
				aria-checked={ride === chosen}
				class="option tabular"
				class:selected={ride === chosen}
				onclick={() => onselect(ride)}
			>
				<span class="dep">{formatTime(ride.departure)}</span>
				<span class="meta">{ride.line.replace(/^Bus /, '')}</span>
			</button>
		{/each}
	</div>
	<p class="ride tabular">
		<span class="cat">{chosen.line}</span>
		{#if chosen.headsign}<span class="muted">richting {chosen.headsign}</span>{/if}
		{#if chosen.operator}<span class="muted">({chosen.operator})</span>{/if}
	</p>
	<ol class="stops tabular">
		<li><span class="t">{formatTime(chosen.departure)}</span> {chosen.from}</li>
		<li><span class="t">{formatTime(chosen.arrival)}</span> {chosen.to}</li>
	</ol>
	<p class="muted">
		{minutesBetween(chosen.departure, chosen.arrival)} min rijden. De halte ligt ± {stopMinutes} min lopen
		van het {side === 'start' ? 'begin' : 'eind'} van de route.
	</p>
{/if}

<style>
	.options {
		display: flex;
		gap: 5px;
		margin: 2px 0 6px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.option {
		flex: none;
		display: grid;
		padding: 3px 8px 2px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		text-align: left;
		line-height: 1.2;
		cursor: pointer;
	}

	.option:hover {
		border-color: var(--warn);
	}

	.option.selected {
		border-color: var(--warn);
		background: var(--warn);
		color: var(--on-accent);
	}

	.dep {
		font-weight: 700;
	}

	.meta {
		font-size: var(--step--1);
		opacity: 0.8;
	}

	.ride {
		display: flex;
		flex-wrap: wrap;
		gap: 0 6px;
		align-items: baseline;
		margin: 0 0 2px;
	}

	.cat {
		padding: 0 5px;
		border-radius: 3px;
		background: var(--warn);
		color: var(--on-accent);
		font-size: var(--step--1);
		font-weight: 700;
	}

	.stops {
		list-style: none;
		margin: 0 0 4px;
		padding: 0;
	}

	.t {
		display: inline-block;
		min-width: 3em;
		font-weight: 700;
	}

	.muted {
		margin: 0;
		color: var(--muted);
		font-size: var(--step--1);
	}
</style>
