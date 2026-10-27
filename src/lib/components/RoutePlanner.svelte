<script lang="ts">
	import { formatDuration, travelBand } from '#lib/itinerary.js';
	import { stretchKm } from '#lib/path.js';
	import { DAY_WALK_KM } from '#lib/walk.js';
	import type { PathDetail, PathStop, Reachability } from '#lib/types.js';

	interface Props {
		path: PathDetail;
		/** Trains from home, out to a station and back from it. */
		reachability: Reachability;
		reachBack: Reachability;
		/** Stop keys (station codes, or stage ends by bus) of the stretch you're putting together. */
		from: string | null;
		to: string | null;
		/** Open the stretch from `from` to `to`, with its trains. */
		onplan: (from: string, to: string) => void;
		/** Leave the route: back to all walks. */
		onclose: () => void;
	}

	let {
		path,
		reachability,
		reachBack,
		from = $bindable(),
		to = $bindable(),
		onplan,
		onclose
	}: Props = $props();

	/** A stretch longer than this without a station is worth pointing out: no day walk there. */
	const GAP_KM = 30;

	const start = $derived(path.stops.find((s) => s.key === from) ?? null);
	const finish = $derived(path.stops.find((s) => s.key === to) ?? null);
	const stations = $derived(path.stops.filter((s) => !s.place).length);
	const villages = $derived(path.stops.length - stations);

	/** The path's own stage this stop lies on (the one it starts, at a stage's end). */
	function stageAt(stop: PathStop) {
		const on = path.stages.filter(
			(s) => s.line === stop.line && s.fromKm <= stop.km + 0.1 && stop.km < s.toKm - 0.1
		);
		return on.at(-1) ?? path.stages.find((s) => s.line === stop.line && s.toKm >= stop.km - 0.1);
	}

	function pick(stop: PathStop) {
		if (!from || (start && start.line !== stop.line)) {
			from = stop.key;
			to = null;
		} else if (stop.key === from) {
			from = null;
			to = null;
		} else {
			to = stop.key;
			onplan(from, stop.key);
		}
	}

	/** Pick up where the last stretch ended. */
	function nextDay() {
		from = to;
		to = null;
	}

	const km = (n: number) => n.toLocaleString('nl-NL', { maximumFractionDigits: 1 });
</script>

<section class="planner" aria-label="Zelf etappes plannen op {path.name}">
	<button type="button" class="all" onclick={onclose}>Alle wandelingen</button>
	<h2>{path.name}</h2>
	<p class="about">
		{km(path.km)} km, langs {stations} stations binnen loopafstand{villages
			? ` en ${villages} etappeplaatsen met een bus naar een station`
			: ''}.
		{#if !from}
			Kies waar je begint, dan waar je eindigt.
		{:else if start}
			Vanaf {start.place ?? start.name}: kies waar je eindigt. De afstand telt het stuk van en naar
			het perron mee.
		{/if}
	</p>
	{#if to && from}
		<button type="button" class="next" onclick={nextDay}>
			Volgende dag vanaf {finish?.place ?? finish?.name}
		</button>
	{/if}

	<ol class="stops">
		{#each path.stops as stop, i (`${stop.line}-${stop.index}`)}
			{@const prev = path.stops[i - 1]}
			{@const stage = stageAt(stop)}
			{@const out = reachability[stop.code]?.minutes}
			{@const back = reachBack[stop.code]?.minutes}
			{@const day =
				start && start !== stop && start.line === stop.line ? stretchKm(start, stop) : null}
			{#if prev && (prev.line !== stop.line || stop.km - prev.km > GAP_KM)}
				<li class="gap">
					{prev.line !== stop.line
						? 'Onderbroken (veer of ontbrekend stuk)'
						: `${km(stop.km - prev.km)} km zonder station in de buurt`}
				</li>
			{/if}
			<li>
				<button
					type="button"
					class:from={stop.key === from}
					class:to={stop.key === to}
					class:bus={!!stop.place}
					class:far={day != null && (day < DAY_WALK_KM.min || day > DAY_WALK_KM.max)}
					aria-pressed={stop.key === from || stop.key === to}
					onclick={() => pick(stop)}
				>
					<span class="name">{stop.place ?? stop.name}</span>
					<span class="where tabular">
						km {Math.round(stop.km)}{#if stage}, etappe {String(stage.number).padStart(2, '0')}{/if}
						·
						{#if stop.place}bus naar {stop.name}{:else}{km(stop.metres / 1000)} km naar de route{/if}
					</span>
					<span class="numbers tabular">
						{#if day != null}
							<strong>{km(day)} km</strong>
							{#if back != null}<span class="back">terug {formatDuration(back)}</span>{/if}
						{:else if stop.key === from}
							<strong>start</strong>
						{:else}
							<span class="travel band-{travelBand(out)}"
								>{out != null ? formatDuration(out) : '–'}</span
							>
							{#if stop.place}<span class="back">+ bus</span>{/if}
						{/if}
					</span>
				</button>
			</li>
		{/each}
	</ol>
</section>

<style>
	.planner {
		padding: 12px 0 4px;
		border-bottom: 1px solid var(--line);
	}

	/* Like the way back from a walk: the same link, in the same place. */
	.all {
		margin: 0 20px 2px;
		padding: 0;
		border: 0;
		background: none;
		color: var(--rail);
		cursor: pointer;
		font-size: var(--step--1);
	}

	.all::before {
		content: '‹ ';
	}

	h2 {
		margin: 0 20px;
		font-size: var(--step-0);
	}

	.about {
		margin: 4px 20px 8px;
		color: var(--muted);
		font-size: var(--step--1);
	}

	.next {
		margin: 0 20px 8px;
		padding: 4px 12px;
		border: 1px solid var(--ink);
		border-radius: 999px;
		background: var(--surface);
		color: var(--ink);
		font-size: var(--step--1);
		cursor: pointer;
	}

	.stops {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	/* A metro-map spine: the route runs down the left, each station a stop on it. */
	.stops button {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0 12px;
		width: 100%;
		padding: 7px 20px 7px 44px;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}

	/* The route in yellow, outlined dark, as on the day page's map. */
	.stops button::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 23px;
		width: 5px;
		border-inline: 1px solid var(--on-signal);
		background: var(--signal);
	}

	.stops button::after {
		content: '';
		position: absolute;
		top: 12px;
		left: 20px;
		width: 9px;
		height: 9px;
		border: 2px solid var(--ink);
		border-radius: 50%;
		background: var(--surface);
	}

	.stops button:hover {
		background: var(--paper);
	}

	.stops button.from::after,
	.stops button.to::after {
		border-color: var(--ink);
		background: var(--ink);
	}

	.stops button.from,
	.stops button.to {
		background: var(--paper);
	}

	.stops button.far {
		color: var(--muted);
	}

	/* A stage end by bus: a square stop, like a bus stop on a transit map. */
	.stops button.bus::after {
		border-radius: 2px;
	}

	.name {
		font-weight: 700;
	}

	.where {
		grid-column: 1;
		color: var(--muted);
		font-size: var(--step--1);
	}

	.numbers {
		grid-column: 2;
		grid-row: 1 / 3;
		align-self: center;
		display: grid;
		justify-items: end;
		font-size: var(--step--1);
	}

	.back {
		color: var(--muted);
	}

	.gap {
		position: relative;
		padding: 6px 20px 6px 44px;
		color: var(--warn);
		font-size: var(--step--1);
	}

	/* Where there's no station the spine goes dotted. */
	.gap::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 25px;
		border-left: 3px dotted var(--muted);
	}

	.travel {
		font-weight: 700;
	}

	.travel::before {
		content: '';
		display: inline-block;
		width: 14px;
		height: 6px;
		margin-right: 6px;
		vertical-align: middle;
		border-radius: 2px;
		background: var(--band-unknown);
	}

	.band-near::before {
		background: var(--band-near);
	}
	.band-medium::before {
		background: var(--band-medium);
	}
	.band-far::before {
		background: var(--band-far);
	}
	.band-veryfar::before {
		background: var(--band-veryfar);
	}
</style>
