<!--
  One slider with two thumbs, for a range: two native range inputs stacked on one track, so each
  thumb keeps the keyboard and screen-reader behaviour of a real slider. The inputs ignore the
  pointer and only their thumbs take it, so either thumb can be grabbed through the other input.
  A thumb dragged past the other pushes it along rather than crossing it.
-->
<script lang="ts">
	interface Props {
		min: number;
		max: number;
		step?: number;
		low: number;
		high: number;
		/** Accessible names for the two thumbs. */
		lowLabel: string;
		highLabel: string;
	}

	let {
		min,
		max,
		step = 1,
		low = $bindable(),
		high = $bindable(),
		lowLabel,
		highLabel
	}: Props = $props();

	const percent = (v: number) => ((v - min) / (max - min)) * 100;

	/*
	  Where the thumbs meet, the one on top is the one you grab. On the right half that's the low
	  thumb (dragging it left widens the range), on the left half the high one (dragging it right).
	*/
	const lowOnTop = $derived(low > (min + max) / 2);
</script>

<div class="range" style:--lo="{percent(low)}%" style:--hi="{percent(high)}%">
	<input
		type="range"
		{min}
		{max}
		{step}
		value={low}
		aria-label={lowLabel}
		class:top={lowOnTop}
		oninput={(e) => {
			low = e.currentTarget.valueAsNumber;
			if (high < low) high = low;
		}}
	/>
	<input
		type="range"
		{min}
		{max}
		{step}
		value={high}
		aria-label={highLabel}
		oninput={(e) => {
			high = e.currentTarget.valueAsNumber;
			if (low > high) low = high;
		}}
	/>
</div>

<style>
	.range {
		--thumb: 16px;
		position: relative;
		height: var(--thumb);
		min-width: 0;
	}

	/* The track, filled between the thumbs, drawn once under both inputs. */
	.range::before {
		content: '';
		position: absolute;
		top: 50%;
		right: calc(var(--thumb) / 2);
		left: calc(var(--thumb) / 2);
		height: 4px;
		border-radius: 2px;
		transform: translateY(-50%);
		background: linear-gradient(
			to right,
			var(--line) var(--lo),
			var(--rail) var(--lo) var(--hi),
			var(--line) var(--hi)
		);
	}

	input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		background: none;
		pointer-events: none;
		appearance: none;
		-webkit-appearance: none;
	}

	input.top {
		z-index: 1;
	}

	input::-webkit-slider-runnable-track {
		background: none;
	}
	input::-moz-range-track {
		background: none;
	}

	input::-webkit-slider-thumb {
		width: var(--thumb);
		height: var(--thumb);
		border: 2px solid var(--surface);
		border-radius: 50%;
		background: var(--rail);
		cursor: pointer;
		pointer-events: auto;
		-webkit-appearance: none;
	}
	input::-moz-range-thumb {
		width: var(--thumb);
		height: var(--thumb);
		box-sizing: border-box;
		border: 2px solid var(--surface);
		border-radius: 50%;
		background: var(--rail);
		cursor: pointer;
		pointer-events: auto;
	}

	/* The page's focus ring goes round the whole input; put it on the thumb that has the keys. */
	input:focus-visible {
		outline: none;
	}
	input:focus-visible::-webkit-slider-thumb {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	input:focus-visible::-moz-range-thumb {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
