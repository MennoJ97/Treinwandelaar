<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import PhotoViewer from './PhotoViewer.svelte';
	import TripOptions from './TripOptions.svelte';
	import { endLabel, startLabel } from '#lib/walk.js';
	import {
		addMinutes,
		busMinutes,
		amsterdamIso,
		amsterdamYmd,
		formatDuration,
		formatTime,
		walkMinutes
	} from '#lib/itinerary.js';
	import {
		COLLECTION_LABELS,
		WALKABLE_STATION_M,
		type Station,
		type TripOption,
		type WalkDetail
	} from '#lib/types.js';

	interface Props {
		walk: WalkDetail;
		home: Station;
		hasNsKey: boolean;
		onclose: () => void;
	}

	let { walk, home, hasNsKey, onclose }: Props = $props();

	type Load<T> =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'error'; message: string }
		| { status: 'done'; data: T };

	// --- When to go -------------------------------------------------------------------------------
	function defaultStart(): { date: string; time: string } {
		const now = new Date();
		const hour = Number(
			now.toLocaleTimeString('nl-NL', { hour: '2-digit', timeZone: 'Europe/Amsterdam' })
		);
		if (hour >= 14) {
			const tomorrow = new Date(now.getTime() + 24 * 3600_000);
			return { date: amsterdamYmd(tomorrow), time: '09:00' };
		}
		const minutes = Number(
			now.toLocaleTimeString('nl-NL', { minute: '2-digit', timeZone: 'Europe/Amsterdam' })
		);
		const rounded = Math.ceil((hour * 60 + minutes) / 15) * 15;
		const start = Math.max(rounded, 8 * 60);
		const hm = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
		return { date: amsterdamYmd(now), time: hm };
	}

	const initial = defaultStart();
	let date = $state(initial.date);
	let time = $state(initial.time);
	let speedKmh = $state(4.5);
	/** Index of the photo open in the viewer, or null. */
	let viewing = $state<number | null>(null);

	// --- Train out ----------------------------------------------------------------------------------
	let outbound = $state<Load<TripOption[]>>({ status: 'idle' });
	let outIndex = $state(0);
	const startsAtHome = $derived(walk.startStation === home.code);
	const endsAtHome = $derived(walk.endStation === home.code);

	async function fetchTrips(from: string, to: string, dateTime: string, signal?: AbortSignal) {
		const params = new URLSearchParams({ from, to, dateTime });
		const res = await fetch(`/api/trips?${params}`, { signal });
		if (!res.ok)
			throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
		return (await res.json()) as TripOption[];
	}

	$effect(() => {
		if (!hasNsKey || startsAtHome || !walk.startStation) {
			outbound = { status: 'idle' };
			return;
		}
		const controller = new AbortController();
		outbound = { status: 'loading' };
		outIndex = 0;
		const requested = amsterdamIso(date, time);
		fetchTrips(home.code, walk.startStation, requested, controller.signal)
			// NS also returns a few trains just before the requested time; only show ones after it.
			.then(
				(data) =>
					(outbound = {
						status: 'done',
						data: data.filter((t) => new Date(t.departure) >= new Date(requested))
					})
			)
			.catch((err) => {
				if (!controller.signal.aborted) outbound = { status: 'error', message: err.message };
			});
		return () => controller.abort();
	});

	// --- The walk -----------------------------------------------------------------------------------
	const minutesWalking = $derived(walkMinutes(walk.distanceKm, { speedKmh, breakMinPer10Km: 20 }));
	const walkStart = $derived.by(() => {
		if (outbound.status === 'done' && outbound.data[outIndex])
			return outbound.data[outIndex].arrival;
		if (outbound.status === 'loading') return null;
		return amsterdamIso(date, time);
	});
	const busAtStart = $derived((walk.startStationM ?? 0) > WALKABLE_STATION_M);
	const busAtEnd = $derived((walk.endStationM ?? 0) > WALKABLE_STATION_M);
	const busStartMin = $derived(busAtStart ? busMinutes(walk.startStationM!) : 0);
	const busEndMin = $derived(busAtEnd ? busMinutes(walk.endStationM!) : 0);
	/** When you're back at the end station: bus there, walk, bus back. */
	const walkEnd = $derived(
		walkStart ? addMinutes(walkStart, busStartMin + minutesWalking + busEndMin) : null
	);

	// --- Train back ---------------------------------------------------------------------------------
	let back = $state<Load<TripOption[]>>({ status: 'idle' });
	let backIndex = $state(0);
	let loadingLater = $state(false);

	$effect(() => {
		const end = walkEnd;
		if (!hasNsKey || endsAtHome || !walk.endStation || !end) {
			back = { status: 'idle' };
			return;
		}
		const controller = new AbortController();
		back = { status: 'loading' };
		backIndex = 0;
		fetchTrips(walk.endStation, home.code, end, controller.signal)
			.then(
				(data) =>
					(back = {
						status: 'done',
						data: data.filter((t) => new Date(t.departure) >= new Date(end))
					})
			)
			.catch((err) => {
				if (!controller.signal.aborted) back = { status: 'error', message: err.message };
			});
		return () => controller.abort();
	});

	async function later() {
		if (back.status !== 'done' || !walk.endStation) return;
		const last = back.data.at(-1);
		if (!last) return;
		loadingLater = true;
		try {
			const more = await fetchTrips(walk.endStation, home.code, addMinutes(last.departure, 1));
			const seen = new Set(back.data.map((t) => t.departure));
			back = {
				status: 'done',
				data: [...back.data, ...more.filter((t) => !seen.has(t.departure))]
			};
		} finally {
			loadingLater = false;
		}
	}

	const homeArrival = $derived(back.status === 'done' ? back.data[backIndex]?.arrival : null);

	// --- Personal layer -----------------------------------------------------------------------------
	async function save(update: {
		status?: 'wishlist' | 'done' | null;
		ownRating?: number | null;
		notes?: string;
	}) {
		const res = await fetch(`/api/walks/${encodeURIComponent(walk.id)}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(update)
		});
		if (res.ok) await invalidateAll();
	}

	const km = (n: number) => n.toLocaleString('nl-NL', { maximumFractionDigits: 1 });
	const rating = (n: number) => n.toLocaleString('nl-NL', { minimumFractionDigits: 1 });
</script>

<article class="detail">
	<header>
		<button type="button" class="back" onclick={onclose}>Alle wandelingen</button>
		<h2>{walk.name}</h2>
		<p class="route">
			<span class="kind">{COLLECTION_LABELS[walk.collection]}:</span>
			{startLabel(walk)} naar {walk.isLoop ? 'hetzelfde station' : endLabel(walk)}
		</p>
	</header>

	{#if walk.photos.length}
		<div class="photos" aria-label="Foto's">
			{#each walk.photos as photo, i (photo.url)}
				<button
					type="button"
					aria-label="Foto {i + 1} van {walk.photos.length} vergroten"
					onclick={() => (viewing = i)}
				>
					<img
						src={photo.url}
						alt={photo.caption ?? walk.name}
						loading="lazy"
						referrerpolicy="no-referrer"
					/>
				</button>
			{/each}
		</div>
		<PhotoViewer
			photos={walk.photos}
			title={walk.name}
			bind:index={viewing}
			onclose={() => (viewing = null)}
		/>
	{/if}

	<dl class="facts">
		<div>
			<dt>Afstand</dt>
			<dd class="tabular">{km(walk.distanceKm)} km</dd>
		</div>
		<div>
			<dt>Looptijd</dt>
			<dd class="tabular">± {formatDuration(minutesWalking)}</dd>
		</div>
		{#if walk.pavedPct != null}<div>
				<dt>Verhard</dt>
				<dd class="tabular">{walk.pavedPct}%</dd>
			</div>{/if}
		{#if walk.ratingAvg != null}
			<div>
				<dt>Waardering</dt>
				<dd class="tabular">{rating(walk.ratingAvg)} / 5 <small>({walk.reviewCount})</small></dd>
			</div>
		{/if}
	</dl>

	<section class="plan" aria-labelledby="plan-title">
		<h3 id="plan-title">Je dag</h3>
		<div class="when">
			<label>Datum <input type="date" bind:value={date} /></label>
			<label>Vertrek vanaf <input type="time" bind:value={time} step="300" /></label>
		</div>

		{#if !hasNsKey}
			<p class="notice">
				Treintijden zijn uit: zet een <code>NS_API_KEY</code> in <code>.env</code> om vertrek- en terugreizen
				te zien.
			</p>
		{/if}

		<ol class="journey">
			<!-- Out -->
			<li class="stop">
				<span class="time tabular">
					{#if outbound.status === 'done' && outbound.data[outIndex]}{formatTime(
							outbound.data[outIndex].departure
						)}{/if}
				</span>
				<span class="dot home" aria-hidden="true"></span>
				<span class="name">{home.name}</span>
			</li>
			{#if !startsAtHome}
				<li class="seg rail">
					<span class="line" aria-hidden="true"></span>
					<div class="body">
						{#if outbound.status === 'loading'}
							<p class="muted">Treinen zoeken…</p>
						{:else if outbound.status === 'error'}
							<p class="notice">Treintijden ophalen mislukt: {outbound.message}</p>
						{:else if outbound.status === 'done' && !outbound.data.length}
							<p class="notice">Geen treinen gevonden rond dit tijdstip. Kies een andere tijd.</p>
						{:else if outbound.status === 'done'}
							<TripOptions
								trips={outbound.data}
								selected={outIndex}
								onselect={(i) => (outIndex = i)}
							/>
						{/if}
					</div>
				</li>
				<li class="stop">
					<span class="time tabular">{walkStart ? formatTime(walkStart) : ''}</span>
					<span class="dot" aria-hidden="true"></span>
					<span class="name">{walk.startStationName}</span>
				</li>
			{/if}

			<!-- Walk -->
			<li class="seg path">
				<span class="line" aria-hidden="true"></span>
				<div class="body">
					{#if busAtStart}
						<p class="notice">
							De route begint in {walk.startPlace}, {km((walk.startStationM ?? 0) / 1000)} km van het
							station. Neem de bus of een taxi; de planning rekent daar ± {busStartMin} min voor.
						</p>
					{/if}
					<p>
						<strong>{km(walk.distanceKm)} km wandelen</strong>, ± {formatDuration(minutesWalking)} inclusief
						pauzes
					</p>
					<label class="pace">
						Tempo
						<input type="range" min="3" max="6" step="0.25" bind:value={speedKmh} />
						<span class="tabular">{km(speedKmh)} km/u</span>
					</label>
					{#if busAtEnd}
						<p class="notice">
							De route eindigt in {walk.endPlace}, {km((walk.endStationM ?? 0) / 1000)} km van station
							{walk.endStationName}. Neem de bus of een taxi; de planning rekent daar ± {busEndMin} min
							voor.
						</p>
					{/if}
				</div>
			</li>
			<li class="stop">
				<span class="time tabular">{walkEnd ? `± ${formatTime(walkEnd)}` : ''}</span>
				<span class="dot" aria-hidden="true"></span>
				<span class="name">{walk.endStationName ?? walk.endPlace}</span>
			</li>

			<!-- Back -->
			{#if !endsAtHome}
				<li class="seg rail">
					<span class="line" aria-hidden="true"></span>
					<div class="body">
						{#if back.status === 'loading'}
							<p class="muted">Treinen terug zoeken…</p>
						{:else if back.status === 'error'}
							<p class="notice">Treintijden ophalen mislukt: {back.message}</p>
						{:else if back.status === 'done' && !back.data.length}
							<p class="notice">
								Geen treinen meer na aankomst. Vertrek eerder of kies een andere dag.
							</p>
						{:else if back.status === 'done'}
							<TripOptions
								trips={back.data}
								selected={backIndex}
								onselect={(i) => (backIndex = i)}
								onlater={later}
								{loadingLater}
							/>
						{/if}
					</div>
				</li>
				<li class="stop">
					<span class="time tabular">{homeArrival ? formatTime(homeArrival) : ''}</span>
					<span class="dot home" aria-hidden="true"></span>
					<span class="name">{home.name}</span>
				</li>
			{/if}
		</ol>
	</section>

	{#if walk.description}<p class="description">{walk.description}</p>{/if}
	{#if walk.accessibility}<p class="description">{walk.accessibility}</p>{/if}
	{#if walk.dogs}<p class="description"><strong>Honden:</strong> {walk.dogs}</p>{/if}
	{#if walk.features.length}
		<ul class="features">
			{#each walk.features as f (f)}<li>{f}</li>{/each}
		</ul>
	{/if}

	<section class="mine" aria-labelledby="mine-title">
		<h3 id="mine-title">Voor jezelf</h3>
		<div class="status">
			<button
				type="button"
				aria-pressed={walk.status === 'wishlist'}
				onclick={() => save({ status: walk.status === 'wishlist' ? null : 'wishlist' })}
				>Wil ik lopen</button
			>
			<button
				type="button"
				aria-pressed={walk.status === 'done'}
				onclick={() => save({ status: walk.status === 'done' ? null : 'done' })}>Gelopen</button
			>
		</div>
		<div class="stars" role="radiogroup" aria-label="Jouw waardering">
			{#each [1, 2, 3, 4, 5] as n (n)}
				<button
					type="button"
					role="radio"
					aria-checked={walk.ownRating === n}
					aria-label="{n} van 5"
					class:on={(walk.ownRating ?? 0) >= n}
					onclick={() => save({ ownRating: walk.ownRating === n ? null : n })}>★</button
				>
			{/each}
		</div>
		<label class="notes">
			Notities
			<textarea
				rows="2"
				value={walk.notes ?? ''}
				onchange={(e) => save({ notes: e.currentTarget.value })}></textarea>
		</label>
	</section>

	<nav class="links" aria-label="Bronnen">
		<a href={walk.sourceUrl} target="_blank" rel="noreferrer">Route op Wandelnet</a>
		{#if walk.nsUrl}<a href={walk.nsUrl} target="_blank" rel="noreferrer">Wandeling op ns.nl</a
			>{/if}
		{#if walk.gpxUrl}<a href={walk.gpxUrl} target="_blank" rel="noreferrer">GPX downloaden</a>{/if}
	</nav>
</article>

<style>
	.detail {
		padding: 0 20px 28px;
	}

	header {
		position: sticky;
		top: 0;
		z-index: 1;
		margin: 0 -20px;
		padding: 14px 20px 10px;
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}

	.back {
		padding: 0;
		border: 0;
		background: none;
		color: var(--rail);
		cursor: pointer;
		font-size: var(--step--1);
	}

	.back::before {
		content: '‹ ';
	}

	h2 {
		margin: 4px 0 0;
		font-size: var(--step-2);
		line-height: 1.15;
		font-weight: 800;
		letter-spacing: -0.01em;
	}

	.route {
		margin: 2px 0 0;
		color: var(--muted);
	}

	.route .kind {
		color: var(--ink);
		font-weight: 600;
	}

	h3 {
		margin: 24px 0 8px;
		font-size: var(--step-1);
		font-weight: 700;
	}

	.photos {
		display: flex;
		align-items: flex-start; /* otherwise the row stretches images past their aspect ratio */
		gap: 6px;
		margin: 14px -20px 0;
		padding: 0 20px;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
	}

	.photos button {
		flex: 0 0 82%;
		padding: 0;
		border: 0;
		border-radius: var(--radius);
		background: var(--line);
		scroll-snap-align: center;
		cursor: zoom-in;
		line-height: 0;
	}

	.photos img {
		width: 100%;
		height: auto;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: var(--radius);
	}

	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
		gap: 12px;
		margin: 16px 0 0;
	}

	.facts dt {
		font-size: var(--step--1);
		color: var(--muted);
	}

	.facts dd {
		margin: 0;
		font-size: var(--step-1);
		font-weight: 700;
	}

	.facts small {
		font-weight: 400;
		color: var(--muted);
	}

	.when {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 14px;
	}

	.when label {
		display: grid;
		font-size: var(--step--1);
		color: var(--muted);
	}

	.when input {
		padding: 5px 8px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
	}

	/* The journey diagram: time | line | content, like a line map in a timetable. */
	.journey {
		list-style: none;
		margin: 0;
		padding: 0;
		--time: 4.4rem;
		--track: 22px;
	}

	.stop {
		display: grid;
		grid-template-columns: var(--time) var(--track) 1fr;
		align-items: center;
		min-height: 26px;
	}

	.stop .time {
		white-space: nowrap;
		font-weight: 700;
		text-align: right;
		padding-right: 8px;
	}

	.stop .name {
		font-weight: 700;
		padding-left: 6px;
	}

	.dot {
		justify-self: center;
		width: 14px;
		height: 14px;
		border: 3px solid var(--ink);
		border-radius: 50%;
		background: var(--surface);
	}

	.dot.home {
		background: var(--signal);
	}

	.seg {
		display: grid;
		grid-template-columns: var(--time) var(--track) 1fr;
	}

	.seg .line {
		grid-column: 2;
		justify-self: center;
		width: 6px;
		min-height: 36px;
	}

	.rail .line {
		background: var(--rail);
	}

	.path .line {
		width: 0;
		border-left: 4px dashed var(--path);
	}

	.seg .body {
		grid-column: 3;
		padding: 6px 0 10px 6px;
		min-width: 0;
	}

	.seg .body p {
		margin: 0 0 4px;
	}

	.pace {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--step--1);
		color: var(--muted);
	}

	.pace input {
		flex: 1;
		max-width: 140px;
		accent-color: var(--path);
	}

	.muted {
		color: var(--muted);
	}

	.notice {
		margin: 4px 0;
		padding: 6px 9px;
		border-left: 3px solid var(--warn);
		background: var(--notice-bg);
		font-size: var(--step--1);
	}

	.description {
		max-width: 65ch;
		margin: 14px 0 0;
	}

	.features {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 12px 0 0;
		padding: 0;
		list-style: none;
		font-size: var(--step--1);
	}

	.features li {
		padding: 2px 8px;
		border: 1px solid var(--line);
		border-radius: 999px;
	}

	.status {
		display: flex;
		gap: 8px;
	}

	.status button {
		padding: 6px 12px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		cursor: pointer;
	}

	.status button[aria-pressed='true'] {
		border-color: var(--path);
		background: var(--path);
		color: var(--on-accent);
	}

	.stars {
		margin: 10px 0;
	}

	.stars button {
		padding: 0 2px;
		border: 0;
		background: none;
		font-size: 1.5rem;
		line-height: 1;
		color: var(--line);
		cursor: pointer;
	}

	.stars button.on {
		color: var(--signal);
	}

	.notes {
		display: grid;
		gap: 4px;
		font-size: var(--step--1);
		color: var(--muted);
	}

	.notes textarea {
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		color: var(--ink);
		resize: vertical;
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		margin-top: 24px;
		font-size: var(--step--1);
	}

	.links a {
		color: var(--rail);
	}
</style>
