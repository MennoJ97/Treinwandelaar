<script lang="ts">
	import type { LngLat } from '#lib/geo.js';
	import {
		amsterdamMinutes,
		dryChance,
		dryLabel,
		rainAlong,
		WET_MM,
		type DayForecast
	} from '#lib/weather.js';

	interface Props {
		line: LngLat[];
		/** When the route starts, as an ISO time. */
		start: string;
		minutes: number;
		forecast: DayForecast;
	}

	let { line, start, minutes, forecast }: Props = $props();

	const startMinutes = $derived(amsterdamMinutes(new Date(start)));
	const chance = $derived(dryChance(line, startMinutes, minutes, forecast));
	const rain = $derived(rainAlong(line, startMinutes, minutes, forecast));
	const amount = (mm: number) => mm.toLocaleString('nl-NL', { maximumFractionDigits: 1 });
	/** A full bar is 3 mm in the hour: proper rain, anything above it is no walking weather either. */
	const height = (mm: number) => Math.min(100, (mm / 3) * 100);
	const summary = $derived(rain?.map((r) => `${r.hour}:00 ${amount(r.mm)} mm`).join(', ') ?? '');
</script>

{#if chance != null}
	<div class="weather">
		<p>
			<strong class="tabular">{dryLabel(chance)}</strong>
			<span>zolang je loopt, volgens de weerscenario's van ECMWF</span>
		</p>
		{#if rain && !rain.some((r) => r.mm > 0)}
			<p class="note">Geen regen verwacht in deze uren (KNMI)</p>
		{:else if rain}
			<ol class="hours" aria-label="Regen per uur: {summary}">
				{#each rain as r (r.hour)}
					<li class:wet={r.mm >= WET_MM}>
						<span class="amount tabular">{r.mm ? amount(r.mm) : ''}</span>
						<span class="column"><span class="bar" style:height="{height(r.mm)}%"></span></span>
						<span class="hour tabular">{r.hour}</span>
					</li>
				{/each}
			</ol>
			<p class="note">mm regen per uur op de plek waar je dan bent (KNMI)</p>
		{/if}
		<p class="note">
			<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weerdata van Open-Meteo</a>
			(CC BY 4.0)
		</p>
	</div>
{/if}

<style>
	.weather {
		margin: 10px 0;
		font-size: var(--step--1);
	}

	.weather p {
		margin: 0;
	}

	.note {
		color: var(--muted);
	}

	.hours {
		display: flex;
		gap: 3px;
		margin: 8px 0 4px;
		padding: 0;
		list-style: none;
	}

	.hours li {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		min-width: 0;
		max-width: 44px;
	}

	.amount,
	.hour {
		color: var(--muted);
		font-size: 0.85em;
		line-height: 1.4;
		min-height: 1.4em;
	}

	.column {
		display: flex;
		align-items: flex-end;
		width: 100%;
		height: 36px;
		border-bottom: 1px solid var(--line);
	}

	.bar {
		width: 100%;
		background: var(--muted);
	}

	.wet .bar {
		background: var(--ink);
	}

	.wet .amount {
		color: var(--ink);
	}
</style>
