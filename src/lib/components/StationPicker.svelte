<script lang="ts">
	import { searchStations } from '#lib/stationSearch.js';
	import type { Station } from '#lib/types.js';

	interface Props {
		stations: Station[];
		/** NS code of the chosen station. */
		value: string;
		label: string;
	}

	let { stations, value = $bindable(), label }: Props = $props();

	const id = $props.id();
	const current = $derived(stations.find((s) => s.code === value));

	/** What's in the box. Mirrors the chosen station's name unless you're typing. */
	let text = $state('');
	let editing = $state(false);
	let open = $state(false);
	let active = $state(0);

	$effect(() => {
		if (!editing) text = current?.name ?? '';
	});

	const matches = $derived(open ? searchStations(stations, text) : []);

	function choose(station: Station) {
		value = station.code;
		editing = false;
		open = false;
		text = station.name;
	}

	function revert() {
		editing = false;
		open = false;
		text = current?.name ?? '';
	}

	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		editing = true;
		text = e.currentTarget.value;
		open = text.trim().length > 0;
		active = 0;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (!open) {
				editing = true;
				open = true;
				active = 0;
				return;
			}
			const n = matches.length;
			if (n) active = (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
		} else if (e.key === 'Enter') {
			if (open && matches[active]) {
				e.preventDefault();
				choose(matches[active]);
			}
		} else if (e.key === 'Escape') {
			if (open || editing) {
				e.preventDefault();
				revert();
			}
		}
	}
</script>

<div class="picker">
	<label for="{id}-input">{label}</label>
	<div class="field">
		<input
			id="{id}-input"
			type="text"
			role="combobox"
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			aria-autocomplete="list"
			aria-expanded={open}
			aria-controls="{id}-list"
			aria-activedescendant={open && matches[active]
				? `${id}-opt-${matches[active].code}`
				: undefined}
			value={text}
			{oninput}
			{onkeydown}
			placeholder={current?.name}
			onfocus={() => {
				// Start empty with the current station as placeholder, as in the NS app: typing never
				// has to fight a half-selected name (select-on-focus is flaky on touch and after a click).
				editing = true;
				text = '';
			}}
			onblur={revert}
		/>
		{#if open}
			<ul id="{id}-list" role="listbox" aria-label="Stations">
				{#each matches as station, i (station.code)}
					<!-- mousedown, not click: it fires before the input's blur would close the list. -->
					<li
						id="{id}-opt-{station.code}"
						role="option"
						aria-selected={i === active}
						class:active={i === active}
						onmousedown={(e) => {
							e.preventDefault();
							choose(station);
						}}
						onmousemove={() => (active = i)}
					>
						<span>{station.name}</span>
						<span class="code">{station.code}</span>
					</li>
				{:else}
					<li class="empty" role="presentation">Geen station gevonden</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.picker {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	label {
		flex: none;
		color: var(--muted);
	}

	.field {
		position: relative;
		flex: 1;
		min-width: 0;
	}

	input {
		width: 100%;
		padding: 4px 2px;
		border: 0;
		border-bottom: 2px solid var(--signal);
		border-radius: 0;
		background: none;
		color: var(--ink);
		font-weight: 700;
		font-size: var(--step-1); /* ≥16px, so iOS doesn't zoom in on focus */
	}

	input:focus {
		outline: none;
		border-bottom-color: var(--ink);
	}

	input::placeholder {
		color: var(--muted);
		opacity: 1;
	}

	ul {
		position: absolute;
		z-index: 5;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		max-height: 320px;
		overflow-y: auto;
		margin: 0;
		padding: 4px 0;
		list-style: none;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		box-shadow: 0 8px 24px var(--shadow);
	}

	li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 7px 10px;
		cursor: pointer;
	}

	li.active {
		background: var(--paper);
	}

	.code {
		color: var(--muted);
		font-size: var(--step--1);
		font-variant-numeric: tabular-nums;
	}

	.empty {
		color: var(--muted);
		cursor: default;
	}
</style>
