<script lang="ts">
	import type { TripOption } from '#lib/types.js';
	import { formatDuration, formatTime } from '#lib/itinerary.js';

	interface Props {
		trips: TripOption[];
		selected: number;
		onselect: (index: number) => void;
		onlater?: () => void;
		loadingLater?: boolean;
	}

	let { trips, selected, onselect, onlater, loadingLater = false }: Props = $props();

	const chosen = $derived(trips[selected]);
	const crowdLabel: Record<string, string> = {
		LOW: 'rustig',
		MEDIUM: 'gemiddeld druk',
		HIGH: 'druk'
	};

	function delayed(trip: TripOption) {
		return trip.legs.some((l) => l.departure !== l.plannedDeparture);
	}
</script>

<div class="options" role="radiogroup" aria-label="Kies een trein">
	{#each trips as trip, i (trip.departure + i)}
		<button
			type="button"
			role="radio"
			aria-checked={i === selected}
			class="option tabular"
			class:selected={i === selected}
			class:cancelled={trip.status === 'CANCELLED'}
			onclick={() => onselect(i)}
		>
			<span class="dep">{formatTime(trip.departure)}</span>
			<span class="meta">
				{formatDuration(trip.actualDurationMin ?? trip.plannedDurationMin)}{trip.transfers
					? `, ${trip.transfers}× over`
					: ''}
			</span>
			{#if delayed(trip)}<span class="flag">vertraagd</span>{/if}
		</button>
	{/each}
	{#if onlater}
		<button type="button" class="later" onclick={onlater} disabled={loadingLater}>
			{loadingLater ? 'Laden…' : 'Later'}
		</button>
	{/if}
</div>

{#if chosen}
	<ul class="legs">
		{#each chosen.legs as leg, i (i)}
			<li class:cancelled={leg.cancelled}>
				<span class="tabular">{formatTime(leg.departure)}</span>
				{leg.product}{leg.direction ? ` richting ${leg.direction}` : ''}{leg.track
					? `, spoor ${leg.track}`
					: ''}
				{#if i < chosen.legs.length - 1}<span class="transfer">overstappen in {leg.to}</span>{/if}
			</li>
		{/each}
		{#if chosen.crowdForecast && crowdLabel[chosen.crowdForecast]}
			<li class="crowd">Verwachte drukte: {crowdLabel[chosen.crowdForecast]}</li>
		{/if}
		{#if chosen.shareUrl}
			<li>
				<a href={chosen.shareUrl} target="_blank" rel="noreferrer">Open in de NS-reisplanner</a>
			</li>
		{/if}
	</ul>
{/if}

<style>
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 6px 0 8px;
	}

	.option {
		display: grid;
		gap: 0;
		padding: 5px 9px 4px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		text-align: left;
		cursor: pointer;
		line-height: 1.2;
	}

	.option:hover {
		border-color: var(--rail);
	}

	.option.selected {
		border-color: var(--rail);
		background: var(--rail);
		color: var(--on-accent);
	}

	.option.cancelled .dep {
		text-decoration: line-through;
	}

	.dep {
		font-weight: 700;
		font-size: var(--step-1);
	}

	.meta {
		font-size: var(--step--1);
		opacity: 0.8;
	}

	.flag {
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--warn);
	}

	.option.selected .flag {
		color: var(--signal);
	}

	.later {
		padding: 5px 10px;
		border: 1px dashed var(--line);
		border-radius: var(--radius);
		background: none;
		color: var(--muted);
		cursor: pointer;
	}

	.legs {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: var(--step--1);
		color: var(--muted);
	}

	.legs li {
		margin-bottom: 2px;
	}

	.legs .cancelled {
		text-decoration: line-through;
	}

	.transfer {
		display: block;
		padding-left: 3.2em;
		font-style: italic;
	}

	.legs a {
		color: var(--rail);
	}
</style>
