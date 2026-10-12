<script lang="ts">
	import { onMount } from 'svelte';
	import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
	import type { Reachability, Station, WalkSummary } from '#lib/types.js';
	import { travelBand } from '#lib/itinerary.js';

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

	onMount(() => {
		let disposed = false;
		(async () => {
			const maplibregl = await import('maplibre-gl');
			if (disposed) return;
			const m = new maplibregl.Map({
				container,
				style: 'https://tiles.openfreemap.org/styles/positron',
				bounds: NL_BOUNDS,
				fitBoundsOptions: { padding: panelPadding(20) },
				attributionControl: { compact: true }
			});
			m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
			m.on('load', () => {
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
						'line-color': '#ffffff',
						'line-width': ['interpolate', ['linear'], ['zoom'], 7, 5.5, 12, 9]
					}
				});
				m.addLayer({
					id: 'walks-line',
					type: 'line',
					source: 'walks',
					layout: { 'line-cap': 'round', 'line-join': 'round' },
					paint: {
						'line-color': bandColor,
						'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 5]
					}
				});
				m.addLayer({
					id: 'walks-selected',
					type: 'line',
					source: 'walks',
					filter: ['==', ['get', 'id'], ''],
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
						'circle-color': ['case', ['get', 'home'], cssVar('--signal'), '#ffffff'],
						'circle-stroke-color': cssVar('--ink'),
						'circle-stroke-width': ['case', ['get', 'home'], 2.5, 1.5]
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
						'text-halo-color': '#fff',
						'text-halo-width': 1.5
					}
				});

				m.on('click', 'walks-hit', (e) => {
					const id = e.features?.[0]?.properties?.id;
					if (id) onselect(id);
				});
				m.on('mouseenter', 'walks-hit', () => (m.getCanvas().style.cursor = 'pointer'));
				m.on('mouseleave', 'walks-hit', () => (m.getCanvas().style.cursor = ''));
				ready = true;
			});
			map = m;
		})();
		return () => {
			disposed = true;
			map?.remove();
		};
	});

	$effect(() => {
		if (!ready || !map) return;
		(map.getSource('walks') as GeoJSONSource).setData(walkFeatures);
		(map.getSource('stations') as GeoJSONSource).setData(stationFeatures);
	});

	$effect(() => {
		if (!ready || !map) return;
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
