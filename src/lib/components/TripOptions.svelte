<script lang="ts">
	import type { TripLeg, TripOption } from '#lib/types.js';
	import { formatDuration, formatTime, minutesBetween } from '#lib/itinerary.js';

	interface Props {
		trips: TripOption[];
		selected: number;
		onselect: (index: number) => void;
		onlater?: () => void;
		loadingLater?: boolean;
	}

	let { trips, selected, onselect, onlater, loadingLater = false }: Props = $props();

	const chosen = $derived(trips[selected]);
	const crowd: Record<string, { level: number; label: string }> = {
		LOW: { level: 1, label: 'rustig' },
		MEDIUM: { level: 2, label: 'gemiddeld druk' },
		HIGH: { level: 3, label: 'druk' }
	};

	const delayMin = (leg: TripLeg) => minutesBetween(leg.plannedDeparture, leg.departure);
	const delayed = (trip: TripOption) => trip.legs.some((l) => delayMin(l) > 0);

	/**
	 * The trip drawn to scale: a segment per leg and a gap per change, as fractions of the whole.
	 * Labels only go in segments wide enough to hold them.
	 */
	const strip = $derived.by(() => {
		if (!chosen) return [];
		const total = Math.max(1, minutesBetween(chosen.departure, chosen.arrival));
		const parts: {
			kind: 'leg' | 'wait';
			share: number;
			leg?: TripLeg;
			minutes: number;
			at?: string;
		}[] = [];
		chosen.legs.forEach((leg, i) => {
			const ride = Math.max(1, minutesBetween(leg.departure, leg.arrival));
			parts.push({ kind: 'leg', share: ride / total, leg, minutes: ride });
			const next = chosen.legs[i + 1];
			if (next) {
				const wait = Math.max(0, minutesBetween(leg.arrival, next.departure));
				parts.push({ kind: 'wait', share: wait / total, minutes: wait, at: leg.to });
			}
		});
		return parts;
	});
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
			<span class="dep"
				>{formatTime(trip.departure)}{#if delayed(trip)}<span class="late">!</span>{/if}</span
			>
			<span class="meta"
				>{formatDuration(trip.actualDurationMin ?? trip.plannedDurationMin)}{#if trip.transfers}
					<span class="x">{trip.transfers}×</span>{/if}</span
			>
		</button>
	{/each}
	{#if onlater}
		<button type="button" class="later" onclick={onlater} disabled={loadingLater}>
			{loadingLater ? '…' : 'Later'}
		</button>
	{/if}
</div>

{#if chosen}
	<!-- The chosen trip to scale: trains as solid segments, buses hatched, changes as gaps. -->
	<div class="strip" aria-hidden="true">
		{#each strip as part, i (i)}
			{#if part.kind === 'leg' && part.leg}
				<span
					class="ride"
					class:bus={part.leg.isBus}
					class:cancelled={part.leg.cancelled}
					style="flex-grow: {part.share}"
					title="{part.leg.product}, {part.minutes} min"
					>{#if part.share > 0.14}{part.leg.category}{/if}</span
				>
			{:else}
				<span
					class="wait"
					style="flex-grow: {part.share}"
					title="Overstappen in {part.at}: {part.minutes} min"
				></span>
			{/if}
		{/each}
	</div>

	<ol class="legs tabular">
		{#each chosen.legs as leg, i (i)}
			{@const next = chosen.legs[i + 1]}
			<li class:cancelled={leg.cancelled}>
				<span class="t">{formatTime(leg.departure)}</span>
				<span class="cat" class:bus={leg.isBus}>{leg.category}</span>
				<span class="to" title="{leg.product}{leg.direction ? ` richting ${leg.direction}` : ''}"
					>{leg.to}{#if delayMin(leg) > 0}<span class="late"> +{delayMin(leg)}</span>{/if}</span
				>
				{#if leg.track}<span class="track" title="Spoor {leg.track}">{leg.track}</span>{/if}
			</li>
			{#if next}
				<li class="change">
					<span class="t"></span>
					<span>{minutesBetween(leg.arrival, next.departure)} min overstappen</span>
				</li>
			{/if}
		{/each}
	</ol>

	<div class="foot">
		{#if chosen.crowdForecast && crowd[chosen.crowdForecast]}
			{@const c = crowd[chosen.crowdForecast]}
			<span class="crowd" title="Verwachte drukte: {c.label}">
				<span class="bars" aria-hidden="true">
					{#each [1, 2, 3] as n (n)}<span class:on={n <= c.level}></span>{/each}
				</span>
				{c.label}
			</span>
		{/if}
		{#if chosen.shareUrl}
			<a href={chosen.shareUrl} target="_blank" rel="noreferrer">NS-reisplanner</a>
		{/if}
	</div>
{/if}

<style>
	/* One row of departures you can swipe through, instead of a grid of big tiles. */
	.options {
		display: flex;
		gap: 5px;
		margin: 2px 0 8px;
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
	}

	.meta {
		font-size: var(--step--1);
		opacity: 0.8;
	}

	.x {
		margin-left: 3px;
	}

	.late {
		margin-left: 2px;
		color: var(--warn);
		font-weight: 700;
	}

	.option.selected .late {
		color: var(--signal);
	}

	.later {
		flex: none;
		padding: 0 10px;
		border: 1px dashed var(--line);
		border-radius: var(--radius);
		background: none;
		color: var(--muted);
		cursor: pointer;
	}

	.strip {
		display: flex;
		gap: 2px;
		height: 16px;
		margin-bottom: 6px;
	}

	.ride {
		display: grid;
		place-items: center;
		min-width: 6px;
		border-radius: 3px;
		background: var(--rail);
		color: var(--on-accent);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		overflow: hidden;
	}

	.ride.bus {
		background: repeating-linear-gradient(
			135deg,
			var(--warn) 0 4px,
			color-mix(in srgb, var(--warn) 70%, var(--surface)) 4px 8px
		);
	}

	.ride.cancelled {
		opacity: 0.35;
	}

	.wait {
		min-width: 3px;
		border-radius: 3px;
		background: var(--line);
	}

	.legs {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--step--1);
	}

	.legs li {
		display: grid;
		grid-template-columns: 2.6rem auto 1fr auto;
		align-items: center;
		gap: 6px;
		min-height: 20px;
	}

	.legs li.cancelled {
		text-decoration: line-through;
		color: var(--muted);
	}

	.t {
		font-weight: 600;
	}

	.cat {
		min-width: 2.2rem;
		padding: 0 4px;
		border-radius: 3px;
		background: var(--rail);
		color: var(--on-accent);
		font-size: 0.6875rem;
		font-weight: 700;
		text-align: center;
		line-height: 16px;
	}

	.cat.bus {
		background: var(--warn);
	}

	.to {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.track {
		min-width: 1.5rem;
		padding: 0 4px;
		border: 1px solid var(--line);
		border-radius: 3px;
		color: var(--muted);
		font-size: 0.6875rem;
		text-align: center;
		line-height: 15px;
	}

	.legs li.change {
		grid-template-columns: 2.6rem 1fr;
		min-height: 16px;
		color: var(--muted);
		font-size: 0.75rem;
	}

	.foot {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-top: 4px;
		font-size: var(--step--1);
		color: var(--muted);
	}

	.crowd {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.bars {
		display: inline-flex;
		align-items: flex-end;
		gap: 2px;
		height: 10px;
	}

	.bars span {
		width: 3px;
		border-radius: 1px;
		background: var(--line);
	}

	.bars span:nth-child(1) {
		height: 4px;
	}
	.bars span:nth-child(2) {
		height: 7px;
	}
	.bars span:nth-child(3) {
		height: 10px;
	}

	.bars span.on {
		background: var(--muted);
	}

	.foot a {
		color: var(--rail);
		margin-left: auto;
	}
</style>
