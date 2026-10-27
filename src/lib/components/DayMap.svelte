<script module lang="ts">
	/** Where the map looks: where you put it, at you (north up), or at you facing the way you face. */
	export type Camera = 'free' | 'follow' | 'heading';
</script>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
	import type { LngLat } from '#lib/geo.js';
	import { cssVar, styleUrl } from '#lib/mapStyle.js';
	import { splitLine, type Fix } from '#lib/navigate.js';
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

	interface Props {
		/** The walk's line, in walking order. */
		line: LngLat[];
		startLabel: string;
		endLabel: string;
		isLoop: boolean;
		stations: { code: string; name: string; lat: number; lng: number }[];
		here: Fix | null;
		/** Which way you face, degrees clockwise from north; null when that's unknown. */
		heading: number | null;
		/** How far along the line you are, once you've been on it: the part behind you greys out. */
		alongM: number | null;
		/** Off the route: the nearest spot on it, to draw the way back. */
		rejoin: LngLat | null;
		/** A station you might stop at instead: marked, with a line to it. */
		target: { lng: number; lat: number; name: string } | null;
		camera: Camera;
		/** Turning the map with you needs the compass: ask for it, from the tap. False: there's none. */
		oncompass: () => Promise<boolean>;
		/** Pixels at the map's bottom behind the panel (on a phone). */
		bottom?: number;
		credit: string;
	}

	let {
		line,
		startLabel,
		endLabel,
		isLoop,
		stations,
		here,
		heading,
		alongM,
		rejoin,
		target,
		camera = $bindable(),
		oncompass,
		bottom = 0,
		credit
	}: Props = $props();

	const LOCALE = {
		'NavigationControl.ResetBearing': 'Draai de kaart terug naar het noorden',
		'NavigationControl.ZoomIn': 'Inzoomen',
		'NavigationControl.ZoomOut': 'Uitzoomen'
	};

	let container: HTMLDivElement;
	let map: MlMap | undefined = $state();
	let ready = $state(false);
	let me: Marker | undefined;
	let meElement: HTMLDivElement | undefined;

	const EMPTY = { type: 'FeatureCollection' as const, features: [] };
	const lineFeature = (part: string, coordinates: LngLat[]) => ({
		type: 'Feature' as const,
		properties: { part },
		geometry: { type: 'LineString' as const, coordinates }
	});
	const pointFeature = (props: Record<string, string>, coordinates: LngLat) => ({
		type: 'Feature' as const,
		properties: props,
		geometry: { type: 'Point' as const, coordinates }
	});

	/** The walk: behind you and ahead of you, once you're on it; all ahead before that. */
	const walkFeatures = $derived.by(() => {
		if (alongM === null)
			return { type: 'FeatureCollection' as const, features: [lineFeature('ahead', line)] };
		const [behind, ahead] = splitLine(line, alongM);
		return {
			type: 'FeatureCollection' as const,
			features: [lineFeature('done', behind), lineFeature('ahead', ahead)]
		};
	});

	const endFeatures = $derived({
		type: 'FeatureCollection' as const,
		features: [
			pointFeature(
				{ kind: 'start', label: startLabel, caption: isLoop ? 'start en eind' : 'start' },
				line[0]
			),
			...(isLoop
				? []
				: [pointFeature({ kind: 'end', label: endLabel, caption: 'eind' }, line.at(-1)!)])
		]
	});

	const stationFeatures = $derived({
		type: 'FeatureCollection' as const,
		features: stations.map((s) => pointFeature({ name: s.name }, [s.lng, s.lat]))
	});

	/** Dashed lines from you: back to the route, or to the station you might stop at. */
	const guideFeatures = $derived.by(() => {
		if (!here) return EMPTY;
		const from: LngLat = [here.lng, here.lat];
		return {
			type: 'FeatureCollection' as const,
			features: [
				...(rejoin ? [lineFeature('rejoin', [from, rejoin])] : []),
				...(target ? [lineFeature('target', [from, [target.lng, target.lat]])] : [])
			]
		};
	});

	const targetFeatures = $derived(
		target
			? {
					type: 'FeatureCollection' as const,
					features: [pointFeature({ name: target.name }, [target.lng, target.lat])]
				}
			: EMPTY
	);

	/** What the phone is unsure about, as a circle around you. */
	const accuracyFeatures = $derived.by(() => {
		if (!here) return EMPTY;
		const latM = 111_320;
		const lngM = latM * Math.cos((here.lat * Math.PI) / 180);
		const ring: LngLat[] = Array.from({ length: 41 }, (_, i) => {
			const a = (i / 40) * 2 * Math.PI;
			return [
				here.lng + (Math.cos(a) * here.accuracyM) / lngM,
				here.lat + (Math.sin(a) * here.accuracyM) / latM
			];
		});
		return {
			type: 'FeatureCollection' as const,
			features: [
				{
					type: 'Feature' as const,
					properties: {},
					geometry: { type: 'Polygon' as const, coordinates: [ring] }
				}
			]
		};
	});

	/** A chevron for the walking direction along the line, in the colour on the route's green. */
	function chevron() {
		const size = 40;
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		const c = canvas.getContext('2d')!;
		c.strokeStyle = cssVar('--on-accent');
		c.lineWidth = 6;
		c.lineCap = 'round';
		c.lineJoin = 'round';
		c.beginPath();
		c.moveTo(14, 9);
		c.lineTo(26, 20);
		c.lineTo(14, 31);
		c.stroke();
		return c.getImageData(0, 0, size, size);
	}

	function addOverlay(m: MlMap) {
		m.addImage('chevron', chevron(), { pixelRatio: 2 });
		m.addSource('stations', { type: 'geojson', data: stationFeatures });
		m.addSource('walk', { type: 'geojson', data: walkFeatures });
		m.addSource('ends', { type: 'geojson', data: endFeatures });
		m.addSource('guide', { type: 'geojson', data: guideFeatures });
		m.addSource('target', { type: 'geojson', data: targetFeatures });
		m.addSource('accuracy', { type: 'geojson', data: accuracyFeatures });

		m.addLayer({
			id: 'stations',
			type: 'circle',
			source: 'stations',
			minzoom: 9,
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 6],
				'circle-color': cssVar('--surface'),
				'circle-stroke-color': cssVar('--ink'),
				'circle-stroke-width': 1.5
			}
		});
		m.addLayer({
			id: 'station-labels',
			type: 'symbol',
			source: 'stations',
			minzoom: 11,
			layout: {
				'text-field': ['get', 'name'],
				'text-size': 12,
				'text-offset': [0, 1.1],
				'text-anchor': 'top',
				'text-font': ['Noto Sans Regular'],
				'text-optional': true
			},
			paint: {
				'text-color': cssVar('--ink'),
				'text-halo-color': cssVar('--surface'),
				'text-halo-width': 1.5
			}
		});
		// Behind you: a trace. Ahead: the route's green, with chevrons the way you walk it.
		m.addLayer({
			id: 'walk-done',
			type: 'line',
			source: 'walk',
			filter: ['==', ['get', 'part'], 'done'],
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': cssVar('--muted'),
				'line-opacity': 0.55,
				'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 6]
			}
		});
		m.addLayer({
			id: 'walk-casing',
			type: 'line',
			source: 'walk',
			filter: ['==', ['get', 'part'], 'ahead'],
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': cssVar('--map-casing'),
				'line-width': ['interpolate', ['linear'], ['zoom'], 10, 7, 16, 13]
			}
		});
		m.addLayer({
			id: 'walk-ahead',
			type: 'line',
			source: 'walk',
			filter: ['==', ['get', 'part'], 'ahead'],
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': cssVar('--path'),
				'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 9]
			}
		});
		m.addLayer({
			id: 'walk-direction',
			type: 'symbol',
			source: 'walk',
			filter: ['==', ['get', 'part'], 'ahead'],
			minzoom: 12,
			layout: {
				'symbol-placement': 'line',
				'symbol-spacing': 90,
				'icon-image': 'chevron',
				'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.55, 16, 0.9],
				'icon-rotation-alignment': 'map',
				'icon-allow-overlap': true
			}
		});
		m.addLayer({
			id: 'guide',
			type: 'line',
			source: 'guide',
			layout: { 'line-cap': 'round' },
			paint: {
				'line-color': [
					'case',
					['==', ['get', 'part'], 'rejoin'],
					cssVar('--warn'),
					cssVar('--rail')
				],
				'line-width': 3,
				'line-dasharray': [1, 2]
			}
		});
		m.addLayer({
			id: 'ends',
			type: 'circle',
			source: 'ends',
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 8],
				'circle-color': [
					'case',
					['==', ['get', 'kind'], 'start'],
					cssVar('--ink'),
					cssVar('--surface')
				],
				'circle-stroke-color': [
					'case',
					['==', ['get', 'kind'], 'start'],
					cssVar('--surface'),
					cssVar('--ink')
				],
				'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'start'], 2, 3]
			}
		});
		m.addLayer({
			id: 'end-labels',
			type: 'symbol',
			source: 'ends',
			layout: {
				'text-field': [
					'format',
					['get', 'label'],
					{ 'font-scale': 1 },
					'\n',
					{},
					['get', 'caption'],
					{ 'font-scale': 0.85, 'text-color': cssVar('--muted') }
				],
				'text-size': 13,
				'text-font': ['Noto Sans Bold'],
				'text-anchor': 'bottom',
				'text-offset': [0, -0.8],
				'text-allow-overlap': true
			},
			paint: {
				'text-color': cssVar('--ink'),
				'text-halo-color': cssVar('--surface'),
				'text-halo-width': 1.75
			}
		});
		m.addLayer({
			id: 'target',
			type: 'circle',
			source: 'target',
			paint: {
				'circle-radius': 8,
				'circle-color': cssVar('--signal'),
				'circle-stroke-color': cssVar('--ink'),
				'circle-stroke-width': 2.5
			}
		});
		m.addLayer({
			id: 'target-label',
			type: 'symbol',
			source: 'target',
			layout: {
				'text-field': ['get', 'name'],
				'text-size': 13,
				'text-font': ['Noto Sans Bold'],
				'text-anchor': 'top',
				'text-offset': [0, 1],
				'text-allow-overlap': true
			},
			paint: {
				'text-color': cssVar('--ink'),
				'text-halo-color': cssVar('--surface'),
				'text-halo-width': 1.75
			}
		});
		m.addLayer({
			id: 'accuracy',
			type: 'fill',
			source: 'accuracy',
			paint: { 'fill-color': cssVar('--rail'), 'fill-opacity': 0.12 }
		});
	}

	onMount(() => {
		let disposed = false;
		let onTheme: (() => void) | undefined;
		(async () => {
			const maplibregl = await import('maplibre-gl');
			if (disposed) return;
			maplibregl.setWorkerUrl(workerUrl);
			const lngs = line.map((p) => p[0]);
			const lats = line.map((p) => p[1]);
			const m = new maplibregl.Map({
				container,
				style: styleUrl(),
				bounds: [
					[Math.min(...lngs), Math.min(...lats)],
					[Math.max(...lngs), Math.max(...lats)]
				],
				fitBoundsOptions: { padding: overviewPadding() },
				attributionControl: { compact: true, customAttribution: credit },
				locale: LOCALE
			});
			const attribution = container.querySelector('.maplibregl-ctrl-attrib');
			attribution?.classList.remove('maplibregl-compact-show');
			attribution?.removeAttribute('open');
			// The compass: it shows where north is once the map turns with you; a tap puts north up.
			m.addControl(
				new maplibregl.NavigationControl({ showZoom: false, visualizePitch: true }),
				'top-right'
			);
			// You, as an arrow the way you face (a dot while that's unknown). Turned on the map, not
			// the screen, so it keeps pointing the right way whichever way the map turns.
			meElement = document.createElement('div');
			meElement.className = 'day-me';
			meElement.innerHTML =
				'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 19.5 20.5 12 16.25 4.5 20.5Z"/></svg>';
			me = new maplibregl.Marker({
				element: meElement,
				rotationAlignment: 'map',
				pitchAlignment: 'map'
			});
			m.on('load', () => {
				addOverlay(m);
				ready = true;
			});
			// Dragging the map yourself lets go of you; the button picks you up again.
			m.on('dragstart', (e) => {
				if (e.originalEvent) camera = 'free';
			});
			m.on('rotatestart', (e) => {
				if (e.originalEvent && camera === 'heading') camera = 'follow';
			});
			onTheme = () => {
				m.setStyle(styleUrl(), { diff: false });
				m.once('style.load', () => addOverlay(m));
			};
			window.addEventListener('themechange', onTheme);
			map = m;
		})();
		return () => {
			disposed = true;
			if (onTheme) window.removeEventListener('themechange', onTheme);
			map?.remove();
		};
	});

	$effect(() => {
		if (!ready || !map) return;
		const data = {
			stations: stationFeatures,
			walk: walkFeatures,
			ends: endFeatures,
			guide: guideFeatures,
			target: targetFeatures,
			accuracy: accuracyFeatures
		};
		// Mid style swap the sources are briefly gone; addOverlay picks up the latest data then.
		for (const [id, features] of Object.entries(data))
			(map.getSource(id) as GeoJSONSource | undefined)?.setData(features);
	});

	// You on the map: where, and which way.
	$effect(() => {
		if (!map || !me || !meElement) return;
		if (!here) {
			me.remove();
			return;
		}
		me.setLngLat([here.lng, here.lat]);
		if (!me.getElement().isConnected) me.addTo(map);
		meElement.classList.toggle('facing', heading !== null);
		me.setRotation(heading ?? 0);
	});

	// --- Where the map looks ------------------------------------------------------------------------
	/** Room for the panel; turned with you, you sit low on the screen, to see more of what's ahead. */
	function cameraPadding(mode: Camera) {
		const visible = container.clientHeight - bottom;
		return { top: mode === 'heading' ? visible * 0.4 : 0, bottom, left: 0, right: 0 };
	}

	function overviewPadding() {
		return { top: 56, right: 56, left: 40, bottom: bottom + 40 };
	}

	$effect(() => {
		const fix = here;
		const mode = camera;
		const facing = heading;
		if (!ready || !map || !fix || mode === 'free') return;
		untrack(() => {
			const m = map!;
			m.easeTo({
				center: [fix.lng, fix.lat],
				// Close enough to see the next fork, the first time it finds you.
				...(m.getZoom() < 14 && { zoom: 16 }),
				bearing: mode === 'heading' ? (facing ?? m.getBearing()) : 0,
				padding: cameraPadding(mode),
				duration: 300
			});
		});
	});

	let noCompass = $state(false);
	async function cycle() {
		if (camera === 'free') camera = 'follow';
		else if (camera === 'follow') {
			// Asked here, in the tap: iOS only hands out the compass from one.
			if (await oncompass()) camera = 'heading';
			else noCompass = true;
		} else camera = 'follow';
	}

	/** The whole walk, and the map lets go of you. */
	export function overview() {
		if (!map) return;
		camera = 'free';
		const lngs = line.map((p) => p[0]);
		const lats = line.map((p) => p[1]);
		map.fitBounds(
			[
				[Math.min(...lngs), Math.min(...lats)],
				[Math.max(...lngs), Math.max(...lats)]
			],
			{ padding: overviewPadding(), bearing: 0, duration: 800 }
		);
	}

	const cameraLabel = $derived(
		camera === 'free'
			? 'Volg mijn locatie'
			: camera === 'follow'
				? noCompass
					? 'Je telefoon geeft geen kompas door'
					: 'Draai de kaart mee met je kijkrichting'
				: 'Noorden boven'
	);
</script>

<div class="day-map">
	<div class="map" bind:this={container} role="region" aria-label="Kaart van je route"></div>
	<div class="buttons">
		<button
			type="button"
			class="camera {camera}"
			aria-label={cameraLabel}
			title={cameraLabel}
			disabled={!here}
			onclick={cycle}
		>
			{#if camera === 'heading'}
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 18.5 19 12 15.3 5.5 19Z" /></svg>
			{:else}
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><circle cx="12" cy="12" r="4" /><path
						d="M12 2v4M12 18v4M2 12h4M18 12h4"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2" /></svg
				>
			{/if}
		</button>
		<button
			type="button"
			class="overview"
			aria-label="Hele route"
			title="Hele route"
			onclick={overview}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"
				><path
					d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				/></svg
			>
		</button>
	</div>
</div>

<style>
	.day-map {
		position: absolute;
		inset: 0;
	}

	.map {
		position: absolute;
		inset: 0;
	}

	/* Under MapLibre's compass, in its style: square white buttons with a shadow. */
	.buttons {
		position: absolute;
		top: 58px;
		right: 10px;
		display: grid;
		gap: 8px;
	}

	.buttons button {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: var(--surface);
		color: var(--ink);
		box-shadow: 0 0 0 2px var(--shadow);
		cursor: pointer;
	}

	.buttons button:disabled {
		color: var(--muted);
		cursor: default;
	}

	.buttons svg {
		width: 22px;
		height: 22px;
		fill: currentColor;
	}

	.camera.follow,
	.camera.heading {
		color: var(--rail);
	}

	.map :global(.maplibregl-ctrl-group button) {
		width: 40px;
		height: 40px;
	}

	/* You: a dot, and an arrow once the way you face is known. */
	.map :global(.day-me) {
		width: 34px;
		height: 34px;
	}

	.map :global(.day-me svg) {
		display: none;
		width: 100%;
		height: 100%;
		fill: var(--rail);
		stroke: var(--map-casing);
		stroke-width: 2;
		stroke-linejoin: round;
		filter: drop-shadow(0 1px 2px var(--shadow));
	}

	.map :global(.day-me.facing svg) {
		display: block;
	}

	.map :global(.day-me:not(.facing))::after {
		content: '';
		position: absolute;
		inset: 7px;
		border: 3px solid var(--map-casing);
		border-radius: 50%;
		background: var(--rail);
		box-shadow: 0 1px 3px var(--shadow);
	}
</style>
