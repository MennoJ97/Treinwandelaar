<script lang="ts">
	import { onMount } from 'svelte';
	import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
	import type { Reachability, Station, WalkSummary } from '#lib/types.js';
	import { travelBand } from '#lib/itinerary.js';
	// MapLibre 6 looks for its worker next to its own module. In a production build that module is
	// a renamed chunk, so the worker isn't there; importing it as an asset makes Vite emit it.
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

	interface Props {
		walks: WalkSummary[];
		stations: Station[];
		home: string;
		reachability: Reachability;
		selectedId: string | null;
		onselect: (id: string | null) => void;
	}

	let { walks, stations, home, reachability, selectedId, onselect }: Props = $props();

	let container: HTMLDivElement;
	let map: MlMap | undefined = $state();
	let ready = $state(false);

	const NL_BOUNDS: [[number, number], [number, number]] = [
		[3.3, 50.75],
		[7.25, 53.55]
	];

	/** On wide screens the list panel floats over the map's left edge; keep routes out from under it. */
	function panelPadding(base: number) {
		const wide = window.matchMedia('(min-width: 800px)').matches;
		return wide ? { top: base, bottom: base, right: base, left: 412 + base } : base;
	}

	function cssVar(name: string) {
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	}

	/** OpenFreeMap style matching the page theme (--map-style is set per theme in +layout). */
	function styleUrl() {
		const style = cssVar('--map-style').replace(/['"]/g, '') || 'positron';
		return `https://tiles.openfreemap.org/styles/${style}`;
	}

	const walkFeatures = $derived({
		type: 'FeatureCollection' as const,
		features: walks.map((w) => ({
			type: 'Feature' as const,
			properties: {
				id: w.id,
				name: w.name,
				band: travelBand(w.startStation ? reachability[w.startStation]?.minutes : null)
			},
			geometry: { type: 'LineString' as const, coordinates: w.geometry }
		}))
	});

	const stationFeatures = $derived.by(() => {
		const used = new Set(walks.flatMap((w) => [w.startStation, w.endStation]));
		used.add(home);
		return {
			type: 'FeatureCollection' as const,
			features: stations
				.filter((s) => used.has(s.code))
				.map((s) => ({
					type: 'Feature' as const,
					properties: { code: s.code, name: s.name, home: s.code === home },
					geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] }
				}))
		};
	});

	/**
	 * Our sources and layers on top of the basemap. Colours are read from the CSS tokens when
	 * drawing, so this runs again after a theme switch replaces the basemap style.
	 */
	function addOverlay(m: MlMap) {
		m.addSource('walks', { type: 'geojson', data: walkFeatures });
		m.addSource('stations', { type: 'geojson', data: stationFeatures });

		const bandColor = [
			'match',
			['get', 'band'],
			'near',
			cssVar('--band-near'),
			'medium',
			cssVar('--band-medium'),
			'far',
			cssVar('--band-far'),
			'veryfar',
			cssVar('--band-veryfar'),
			cssVar('--band-unknown')
		] as unknown as string;

		m.addLayer({
			id: 'walks-casing',
			type: 'line',
			source: 'walks',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': cssVar('--map-casing'),
				'line-width': ['interpolate', ['linear'], ['zoom'], 7, 5.5, 12, 9]
			}
		});
		m.addLayer({
			id: 'walks-line',
			type: 'line',
			source: 'walks',
			layout: {
				'line-cap': 'round',
				'line-join': 'round',
				// Near walks on top: where routes overlap, the ones you'd pick shouldn't be buried.
				'line-sort-key': [
					'match',
					['get', 'band'],
					'near',
					4,
					'medium',
					3,
					'far',
					2,
					'veryfar',
					1,
					0
				]
			},
			paint: {
				'line-color': bandColor,
				'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 5]
			}
		});
		m.addLayer({
			id: 'walks-selected',
			type: 'line',
			source: 'walks',
			filter: ['==', ['get', 'id'], selectedId ?? ''],
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': cssVar('--ink'),
				'line-width': ['interpolate', ['linear'], ['zoom'], 7, 4, 12, 7]
			}
		});
		// Invisible wide line so thin routes are easy to click and tap.
		m.addLayer({
			id: 'walks-hit',
			type: 'line',
			source: 'walks',
			paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 }
		});
		m.addLayer({
			id: 'stations',
			type: 'circle',
			source: 'stations',
			paint: {
				'circle-radius': [
					'interpolate',
					['linear'],
					['zoom'],
					7,
					['case', ['get', 'home'], 6, 3],
					12,
					['case', ['get', 'home'], 9, 5]
				],
				'circle-color': ['case', ['get', 'home'], cssVar('--signal'), cssVar('--surface')],
				'circle-stroke-color': cssVar('--ink'),
				'circle-stroke-width': ['case', ['get', 'home'], 2.5, 1.5],
				// At country zoom hundreds of station dots drown out the route colours; fade them in as
				// you zoom towards a region. Home stays visible throughout.
				'circle-opacity': [
					'interpolate',
					['linear'],
					['zoom'],
					8,
					['case', ['get', 'home'], 1, 0],
					9.5,
					1
				],
				'circle-stroke-opacity': [
					'interpolate',
					['linear'],
					['zoom'],
					8,
					['case', ['get', 'home'], 1, 0],
					9.5,
					1
				]
			}
		});
		m.addLayer({
			id: 'station-labels',
			type: 'symbol',
			source: 'stations',
			minzoom: 9,
			layout: {
				'text-field': ['get', 'name'],
				'text-size': 12,
				'text-offset': [0, 1.1],
				'text-anchor': 'top',
				'text-font': ['Noto Sans Regular']
			},
			paint: {
				'text-color': cssVar('--ink'),
				'text-halo-color': cssVar('--surface'),
				'text-halo-width': 1.5
			}
		});
	}

	onMount(() => {
		let disposed = false;
		let onTheme: (() => void) | undefined;
		(async () => {
			const maplibregl = await import('maplibre-gl');
			if (disposed) return;
			maplibregl.setWorkerUrl(workerUrl);
			const m = new maplibregl.Map({
				container,
				style: styleUrl(),
				bounds: NL_BOUNDS,
				fitBoundsOptions: { padding: panelPadding(20) },
				attributionControl: { compact: true }
			});
			m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
			m.on('load', () => {
				addOverlay(m);
				// Layer-bound listeners belong to the map, so they survive a style swap.
				m.on('click', 'walks-hit', (e) => {
					const id = e.features?.[0]?.properties?.id;
					if (id) onselect(id);
				});
				m.on('mouseenter', 'walks-hit', () => (m.getCanvas().style.cursor = 'pointer'));
				m.on('mouseleave', 'walks-hit', () => (m.getCanvas().style.cursor = ''));
				ready = true;
			});
			// family.js fires this whenever the theme on screen changes: the switch, the system,
			// or another tab or mhjansen.nl site changing the shared cookie.
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
		const data = [walkFeatures, stationFeatures] as const;
		// Mid style swap the sources are briefly gone; addOverlay picks up the latest data then.
		(map.getSource('walks') as GeoJSONSource | undefined)?.setData(data[0]);
		(map.getSource('stations') as GeoJSONSource | undefined)?.setData(data[1]);
	});

	$effect(() => {
		if (!ready || !map) return;
		if (map.getLayer('walks-selected'))
			map.setFilter('walks-selected', ['==', ['get', 'id'], selectedId ?? '']);
		const walk = walks.find((w) => w.id === selectedId);
		if (!walk) return;
		const lngs = walk.geometry.map((p) => p[0]);
		const lats = walk.geometry.map((p) => p[1]);
		map.fitBounds(
			[
				[Math.min(...lngs), Math.min(...lats)],
				[Math.max(...lngs), Math.max(...lats)]
			],
			{ padding: panelPadding(48), maxZoom: 14, duration: 800 }
		);
	});
</script>

<div class="map" bind:this={container} role="region" aria-label="Kaart met wandelroutes"></div>

<style>
	.map {
		position: absolute;
		inset: 0;
	}
</style>
