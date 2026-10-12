<script lang="ts">
	import { largePhoto } from '#lib/photos.js';
	import type { WalkPhoto } from '#lib/types.js';

	interface Props {
		photos: WalkPhoto[];
		title: string;
		/** Index of the open photo, or null when closed. */
		index: number | null;
		onclose: () => void;
	}

	let { photos, title, index = $bindable(), onclose }: Props = $props();

	let dialog: HTMLDialogElement;
	let touchX: number | null = null;

	const photo = $derived(index != null ? photos[index] : null);

	// A native modal dialog: focus moves in and is trapped, Esc closes, the page behind is inert.
	$effect(() => {
		if (index != null && !dialog.open) dialog.showModal();
		if (index == null && dialog.open) dialog.close();
	});

	// Warm the neighbours so stepping through doesn't wait on the network.
	$effect(() => {
		if (index == null) return;
		for (const i of [index - 1, index + 1])
			if (photos[i]) new Image().src = largePhoto(photos[i].url);
	});

	function step(delta: number) {
		if (index == null) return;
		index = (index + delta + photos.length) % photos.length;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') step(1);
		else if (e.key === 'ArrowLeft') step(-1);
	}
</script>

<dialog
	bind:this={dialog}
	aria-label="Foto's van {title}"
	{onclose}
	{onkeydown}
	onclick={(e) => {
		// A click on the backdrop lands on the dialog itself, not on its contents.
		if (e.target === dialog) dialog.close();
	}}
	ontouchstart={(e) => (touchX = e.touches[0].clientX)}
	ontouchend={(e) => {
		if (touchX == null) return;
		const dx = e.changedTouches[0].clientX - touchX;
		if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
		touchX = null;
	}}
>
	{#if photo && index != null}
		<figure>
			<img src={largePhoto(photo.url)} alt={photo.caption ?? title} referrerpolicy="no-referrer" />
			<figcaption>
				<span>{photo.caption ?? title}</span>
				{#if photos.length > 1}<span class="tabular">{index + 1} / {photos.length}</span>{/if}
			</figcaption>
		</figure>
		{#if photos.length > 1}
			<button type="button" class="nav prev" aria-label="Vorige foto" onclick={() => step(-1)}
				>‹</button
			>
			<button type="button" class="nav next" aria-label="Volgende foto" onclick={() => step(1)}
				>›</button
			>
		{/if}
		<button type="button" class="close" aria-label="Sluiten" onclick={() => dialog.close()}
			>×</button
		>
	{/if}
</dialog>

<style>
	/* Photos read best on near-black, whatever the page theme. */
	dialog {
		width: 100vw;
		height: 100dvh;
		max-width: none;
		max-height: none;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: #ecece9;
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 0.88);
	}

	figure {
		display: grid;
		place-items: center;
		align-content: center;
		gap: 10px;
		height: 100%;
		margin: 0;
		padding: 48px 56px 16px;
		pointer-events: none; /* clicks beside the image fall through to the backdrop */
	}

	img {
		max-width: 100%;
		max-height: calc(100dvh - 120px);
		object-fit: contain;
		border-radius: 4px;
		pointer-events: auto;
	}

	figcaption {
		display: flex;
		gap: 16px;
		justify-content: space-between;
		width: min(100%, 900px);
		font-size: var(--step--1);
		color: #b8b8b4;
	}

	button {
		position: fixed;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.12);
		color: #fff;
		cursor: pointer;
		line-height: 1;
	}

	button:hover {
		background: rgb(255 255 255 / 0.24);
	}

	.nav {
		top: 50%;
		width: 44px;
		height: 44px;
		margin-top: -22px;
		font-size: 2rem;
	}

	.prev {
		left: 8px;
	}

	.next {
		right: 8px;
	}

	.close {
		top: 10px;
		right: 10px;
		width: 40px;
		height: 40px;
		font-size: 1.6rem;
	}

	@media (max-width: 600px) {
		figure {
			padding: 56px 8px 16px;
		}

		.nav {
			top: auto;
			bottom: 14px;
			margin-top: 0;
		}
	}
</style>
