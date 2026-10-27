<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type {
		ExpressionSpecification,
		FilterSpecification,
		GeoJSONSource,
		GeolocateControl,
		Map as MlMap
	} from 'maplibre-gl';
	import {
		WALKABLE_STATION_M,
		type Collection,
		type Here,
		type PathDetail,
		type Reachability,
		type Station,
		type TripLeg,
		type WalkSummary
	} from '#lib/types.js';
	import { nearest } from '#lib/geo.js';
	import { cssVar, styleUrl } from '#lib/mapStyle.js';
	import { travelBand } from '#lib/itinerary.js';
	import { endLabel, startLabel } from '#lib/walk.js';
	// MapLibre 6 looks for its worker next to its own module. In a production build that module is
	// a renamed chunk, so the worker isn't there; importing it as an asset makes Vite emit it.
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

	interface Props {
		walks: WalkSummary[];
		/** A whole LAW route or streekpad you're planning stretches on: drawn under the walks. */
		path?: PathDetail | null;
		stations: Station[];
		home: string;
		reachability: Reachability;
		selectedId: string | null;
		/** The walk under the pointer in the list: drawn out on the map, which stays where it is. */
		hoveredId?: string | null;
		/** The open walk's chosen trains out and back, one list of legs per trip: drawn faintly under it. */
		trips?: TripLeg[][];
		/** Where its chosen buses between station and route run; empty where we don't know. */
		rides?: { start: [number, number][]; end: [number, number][] };
		/** Source line for the routes, next to the map data's own attribution. */
		credit: string;
		onselect: (id: string | null) => void;
		/** Which kinds of whole routes to draw faintly under the walks (LAW routes, streekpaden). */
		routeKinds?: Collection[];
		/** You clicked a whole route where no walk lies on it: plan on it. */
		onroute?: (id: string) => void;
		/** You asked the map where you are: here's the station closest to you. */
		onlocate: (code: string) => void;
		/**
		 * Where you are while you follow yourself on the open walk, at every new fix; null once you
		 * stop. Only while a walk is open: then the button follows you instead of picking a station.
		 */
		onposition?: (here: Here | null) => void;
		/** How many pixels at the map's bottom are behind something, like the list on small screens. */
		obscured?: () => number;
	}

	let {
		walks,
		path = null,
		stations,
		home,
		reachability,
		selectedId,
		hoveredId = null,
		trips = [],
		rides = { start: [], end: [] },
		credit,
		onselect,
		routeKinds = [],
		onroute = () => {},
		onlocate,
		onposition = () => {},
		obscured = () => 0
	}: Props = $props();

	/** Further than this from any Dutch station (abroad, say) and we leave the home station alone. */
	const LOCATE_MAX_METRES = 50_000;

	/** MapLibre's control labels, in Dutch like the rest of the page. */
	const LOCALE = {
		'GeolocateControl.FindMyLocation': 'Vind mijn locatie en dichtstbijzijnde station',
		'GeolocateControl.LocationNotAvailable': 'Locatie niet beschikbaar',
		'NavigationControl.ResetBearing': 'Draai de kaart terug naar het noorden',
		'NavigationControl.ZoomIn': 'Inzoomen',
		'NavigationControl.ZoomOut': 'Uitzoomen'
	};

	let container: HTMLDivElement;
	let maplibre: typeof import('maplibre-gl') | undefined;
	let map: MlMap | undefined = $state();
	let ready = $state(false);

	const NL_BOUNDS: [[number, number], [number, number]] = [
		[3.3, 50.75],
		[7.25, 53.55]
	];

	/**
	 * On wide screens the list panel floats over the map's left edge; keep routes out from under it.
	 * `legend` also keeps them clear of the legend in the bottom corner, so a route's end marker
	 * doesn't land behind it. On small screens the list covers the map's bottom, by as much as it's
	 * pulled up; that part never takes more than leaves the routes a usable strip.
	 */
	function panelPadding(base: number, legend = false) {
		const wide = window.matchMedia('(min-width: 800px)').matches;
		if (!wide) {
			const covered = Math.min(obscured(), Math.max(0, container.clientHeight - 2 * base - 160));
			return { top: base, right: base, left: base, bottom: base + (legend ? 40 : 0) + covered };
		}
		return { top: base, right: base, left: 412 + base, bottom: base + (legend ? 124 : 0) };
	}

	const ROUTES_OPACITY: ExpressionSpecification = [
		'interpolate',
		['linear'],
		['zoom'],
		7,
		0.6,
		12,
		0.7
	];
	/** A walk's colour: how far it is from home by train. */
	function bandColors() {
		return [
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
	}

	/**
	 * Out walking, the other walks and the whole routes fade to a trace: still there to see where
	 * you could go, but yours is the one that stands out. Back to normal once you stop following.
	 * Faded by colour, not transparency: one solid faint line, without its casing, stays as faint
	 * where walks overlap, where see-through lines would add up.
	 */
	function applyFocus(m: MlMap) {
		if (!m.getLayer('walks-line')) return;
		const mine = ['==', ['get', 'id'], selectedId ?? ''] as ExpressionSpecification;
		const faint = cssVar('--map-faded');
		const color = focused
			? (['case', mine, bandColors(), faint] as unknown as string)
			: bandColors();
		m.setPaintProperty('walks-casing', 'line-opacity', focused ? ['case', mine, 1, 0] : 1);
		m.setPaintProperty('walks-line', 'line-color', color);
		m.setPaintProperty('walk-ends', 'circle-stroke-color', color);
		m.setPaintProperty('routes-line', 'line-color', focused ? faint : cssVar('--path'));
		m.setPaintProperty('routes-line', 'line-opacity', focused ? 1 : ROUTES_OPACITY);
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

	/**
	 * Where each route itself begins and ends (the first and last point of its line, which is not
	 * always at the station). A loop has one point, its start.
	 */
	const endFeatures = $derived({
		type: 'FeatureCollection' as const,
		features: walks.flatMap((w) => {
			const band = travelBand(w.startStation ? reachability[w.startStation]?.minutes : null);
			const ends = [
				{
					kind: 'start',
					label: startLabel(w),
					caption: w.isLoop ? 'start en eind' : 'start',
					at: w.geometry[0]
				}
			];
			if (!w.isLoop)
				ends.push({ kind: 'end', label: endLabel(w), caption: 'eind', at: w.geometry.at(-1)! });
			return ends.map(({ at, ...props }) => ({
				type: 'Feature' as const,
				properties: { id: w.id, band, ...props },
				geometry: { type: 'Point' as const, coordinates: at }
			}));
		})
	});

	const pathFeatures = $derived({
		type: 'FeatureCollection' as const,
		features: path
			? [
					{
						type: 'Feature' as const,
						properties: {},
						geometry: { type: 'MultiLineString' as const, coordinates: path.lines }
					}
				]
			: []
	});

	/**
	 * How you get to the open walk and home again: the chosen trains along their tracks, and a bus
	 * between station and route where it's too far to walk: the chosen ride along its streets, or
	 * straight from station to route while no ride is known. Changes are dots, named once you zoom in.
	 */
	const transitFeatures = $derived.by(() => {
		const line = (kind: 'train' | 'bus', coordinates: [number, number][]) => ({
			type: 'Feature' as const,
			properties: { kind },
			geometry: { type: 'LineString' as const, coordinates }
		});
		const point = (name: string, coordinates: [number, number]) => ({
			type: 'Feature' as const,
			properties: { name },
			geometry: { type: 'Point' as const, coordinates }
		});
		const features: (ReturnType<typeof line> | ReturnType<typeof point>)[] = [];
		const walk = walks.find((w) => w.id === selectedId);
		if (!walk) return { type: 'FeatureCollection' as const, features };
		for (const legs of trips)
			legs.forEach((leg, i) => {
				if (leg.line.length > 1) features.push(line(leg.isBus ? 'bus' : 'train', leg.line));
				if (i < legs.length - 1 && leg.line.length) features.push(point(leg.to, leg.line.at(-1)!));
			});
		const at = (code: string | null) => {
			const s = code ? stations.find((s) => s.code === code) : undefined;
			return s ? ([s.lng, s.lat] as [number, number]) : null;
		};
		const startStation = at(walk.startStation);
		const endStation = at(walk.endStation);
		if (rides.start.length > 1) features.push(line('bus', rides.start));
		else if (startStation && (walk.startStationM ?? 0) > WALKABLE_STATION_M)
			features.push(line('bus', [startStation, walk.geometry[0]]));
		if (rides.end.length > 1) features.push(line('bus', rides.end));
		else if (endStation && (walk.endStationM ?? 0) > WALKABLE_STATION_M)
			features.push(line('bus', [walk.geometry.at(-1)!, endStation]));
		return { type: 'FeatureCollection' as const, features };
	});

	const selectedFilter = (): FilterSpecification => ['==', ['get', 'id'], selectedId ?? ''];
	const EMPTY = { type: 'FeatureCollection' as const, features: [] };
	/** Whether the whole routes were ever switched on: from then on the source keeps them. */
	let routesWanted = false;

	const routeFilter = (): FilterSpecification => [
		'in',
		['get', 'collection'],
		['literal', routeKinds]
	];
	const hoveredFilter = (): FilterSpecification => ['==', ['get', 'id'], hoveredId ?? ''];

	/** The selected walk's stations are labelled by its own end markers; don't name them twice. */
	const stationLabelFilter = (): FilterSpecification => {
		const walk = walks.find((w) => w.id === selectedId);
		const codes: (string | null)[] = [];
		// Where a bus is needed the marker names the village, so the station keeps its own label.
		if (walk && startLabel(walk) === walk.startStationName) codes.push(walk.startStation);
		if (walk && endLabel(walk) === walk.endStationName) codes.push(walk.endStation);
		return ['!', ['in', ['get', 'code'], ['literal', codes]]];
	};

	const stationFeatures = $derived.by(() => {
		const used = new Set(walks.flatMap((w) => [w.startStation, w.endStation]));
		for (const stop of path?.stops ?? []) used.add(stop.code);
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
		m.addSource('walk-ends', { type: 'geojson', data: endFeatures });
		m.addSource('path', { type: 'geojson', data: pathFeatures });
		m.addSource('transit', { type: 'geojson', data: transitFeatures });
		// Every whole route: a few hundred KB, fetched only once you ask to see them.
		m.addSource('routes', { type: 'geojson', data: routesWanted ? '/api/paths' : EMPTY });

		const bandColor = bandColors();
		// Near walks on top: where routes overlap, the ones you'd pick shouldn't be buried.
		const bandSortKey: ExpressionSpecification = [
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
		];

		// The open walk's trains and buses, at the bottom of the stack: thin and grey like the
		// basemap's own railways, so the walk stays what you look at. Rails get sleepers once there's
		// room for them; a bus is dashed.
		const isTrain: FilterSpecification = ['==', ['get', 'kind'], 'train'];
		m.addLayer({
			id: 'transit-casing',
			type: 'line',
			source: 'transit',
			filter: ['==', ['geometry-type'], 'LineString'],
			layout: { 'line-join': 'round' },
			paint: {
				'line-color': cssVar('--map-casing'),
				'line-opacity': 0.8,
				'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3.5, 12, 5.5]
			}
		});
		m.addLayer({
			id: 'transit-rail',
			type: 'line',
			source: 'transit',
			filter: isTrain,
			layout: { 'line-join': 'round' },
			paint: {
				'line-color': cssVar('--transit'),
				'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 12, 3]
			}
		});
		m.addLayer({
			id: 'transit-rail-sleepers',
			type: 'line',
			source: 'transit',
			filter: isTrain,
			minzoom: 9,
			layout: { 'line-join': 'round' },
			paint: {
				'line-color': cssVar('--map-casing'),
				'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 12, 1.75],
				'line-dasharray': [2, 2]
			}
		});
		m.addLayer({
			id: 'transit-bus',
			type: 'line',
			source: 'transit',
			filter: ['==', ['get', 'kind'], 'bus'],
			paint: {
				'line-color': cssVar('--transit'),
				'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 12, 2.5],
				'line-dasharray': [2, 1.5]
			}
		});
		m.addLayer({
			id: 'transit-changes',
			type: 'circle',
			source: 'transit',
			filter: ['==', ['geometry-type'], 'Point'],
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2.5, 12, 4],
				'circle-color': cssVar('--map-casing'),
				'circle-stroke-color': cssVar('--transit'),
				'circle-stroke-width': 1.5
			}
		});
		m.addLayer({
			id: 'transit-change-labels',
			type: 'symbol',
			source: 'transit',
			filter: ['==', ['geometry-type'], 'Point'],
			minzoom: 9,
			layout: {
				'text-field': ['concat', 'overstappen op ', ['get', 'name']],
				'text-size': 11,
				'text-offset': [0, 0.9],
				'text-anchor': 'top',
				'text-font': ['Noto Sans Regular'],
				'text-optional': true
			},
			paint: {
				'text-color': cssVar('--muted'),
				'text-halo-color': cssVar('--surface'),
				'text-halo-width': 1.5
			}
		});
		// Every LAW route and streekpad, faint, so the stretches without a day walk show too: you can
		// still plan on them. Under every walk (only the open walk's trains and buses lie lower), and
		// thinner than any walk.
		m.addLayer({
			id: 'routes-line',
			type: 'line',
			source: 'routes',
			filter: routeFilter(),
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': cssVar('--path'),
				'line-opacity': ROUTES_OPACITY,
				'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 12, 3]
			}
		});
		m.addLayer({
			id: 'routes-hit',
			type: 'line',
			source: 'routes',
			filter: routeFilter(),
			paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 12 }
		});
		// The whole route you're planning on, dotted like a path on a topographic map.
		m.addLayer({
			id: 'path-line',
			type: 'line',
			source: 'path',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': cssVar('--path'),
				'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2, 12, 4],
				'line-dasharray': [1, 1.5]
			}
		});
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
				'line-sort-key': bandSortKey
			},
			paint: {
				'line-color': bandColor,
				'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 5]
			}
		});
		// Terminus rings, as on a metro map: hollow, in the route's own colour, just wider than the
		// line so the end reads as an end rather than a round line cap.
		m.addLayer({
			id: 'walk-ends',
			type: 'circle',
			source: 'walk-ends',
			layout: { 'circle-sort-key': bandSortKey },
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2.5, 12, 4.5],
				'circle-color': cssVar('--map-casing'),
				'circle-stroke-color': bandColor,
				'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 7, 1.75, 12, 2.5]
			}
		});
		m.addLayer({
			id: 'walks-selected',
			type: 'line',
			source: 'walks',
			filter: selectedFilter(),
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': cssVar('--ink'),
				'line-width': ['interpolate', ['linear'], ['zoom'], 7, 4, 12, 7]
			}
		});
		// The walk you're pointing at in the list. Signal yellow, outlined in ink: ink alone vanishes
		// among the near walks (the band closest to it in either theme), and yellow is the one colour
		// no route has. Its ends go unnamed; the list row says them.
		m.addLayer({
			id: 'walks-hover-casing',
			type: 'line',
			source: 'walks',
			filter: hoveredFilter(),
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': cssVar('--ink'),
				'line-width': ['interpolate', ['linear'], ['zoom'], 7, 6.5, 12, 10]
			}
		});
		m.addLayer({
			id: 'walks-hover',
			type: 'line',
			source: 'walks',
			filter: hoveredFilter(),
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': cssVar('--signal'),
				'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3.5, 12, 6]
			}
		});
		m.addLayer({
			id: 'walk-ends-hover',
			type: 'circle',
			source: 'walk-ends',
			filter: hoveredFilter(),
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 4, 12, 6],
				'circle-color': cssVar('--signal'),
				'circle-stroke-color': cssVar('--ink'),
				'circle-stroke-width': 2
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
			filter: stationLabelFilter(),
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
		// The selected walk: a solid dot where you set off, a ring where you finish, both named.
		m.addLayer({
			id: 'walk-ends-selected',
			type: 'circle',
			source: 'walk-ends',
			filter: selectedFilter(),
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 5, 12, 7],
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
			id: 'walk-ends-selected-labels',
			type: 'symbol',
			source: 'walk-ends',
			filter: selectedFilter(),
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
				// Above the marker, clear of the legend in the bottom corner. Always shown, and the
				// basemap's own place names make way for it.
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
		applyFocus(m);
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
				attributionControl: { compact: true, customAttribution: credit },
				locale: LOCALE
			});
			// MapLibre opens the compact attribution at first and folds it on your first drag. Start
			// folded, so it doesn't lie over the routes and the legend; the (i) button opens it.
			const attribution = container.querySelector('.maplibregl-ctrl-attrib');
			attribution?.classList.remove('maplibregl-compact-show');
			attribution?.removeAttribute('open');
			// The compass sits under the zoom buttons; it turns with the map and a click puts north
			// back up (and the map flat again, after a two-finger tilt).
			m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
			// The location button under it comes from the effect below: what it does depends on
			// whether a walk is open.
			maplibre = maplibregl;
			m.on('load', () => {
				addOverlay(m);
				// Layer-bound listeners belong to the map, so they survive a style swap.
				m.on('click', 'walks-hit', (e) => {
					const id = e.features?.[0]?.properties?.id;
					// Out walking, a tap on a faded walk shouldn't swap yours for it.
					if (id && !(focused && id !== selectedId)) onselect(id);
				});
				// A whole route under a walk: the walk wins, it's what you see on top.
				m.on('click', 'routes-hit', (e) => {
					if (focused) return;
					if (m.queryRenderedFeatures(e.point, { layers: ['walks-hit'] }).length) return;
					const id = e.features?.[0]?.properties?.id;
					if (id) onroute(id);
				});
				for (const layer of ['walks-hit', 'routes-hit']) {
					m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
					m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
				}
				ready = true;
			});
			// family.js fires this whenever the theme on screen changes: the switch, the system,
			// or another tab or family site changing the shared cookie.
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
		const data = [
			walkFeatures,
			stationFeatures,
			endFeatures,
			pathFeatures,
			transitFeatures
		] as const;
		// Mid style swap the sources are briefly gone; addOverlay picks up the latest data then.
		(map.getSource('walks') as GeoJSONSource | undefined)?.setData(data[0]);
		(map.getSource('stations') as GeoJSONSource | undefined)?.setData(data[1]);
		(map.getSource('walk-ends') as GeoJSONSource | undefined)?.setData(data[2]);
		(map.getSource('path') as GeoJSONSource | undefined)?.setData(data[3]);
		(map.getSource('transit') as GeoJSONSource | undefined)?.setData(data[4]);
	});

	// --- Where you are -------------------------------------------------------------------------------
	/**
	 * With no walk open the button finds you once and makes the station nearest to you home. With a
	 * walk open it keeps following you as a dot on the map, and leaves home alone: you're out
	 * walking. MapLibre can't switch a control between the two, so each change swaps in a new one.
	 */
	let geolocate: GeolocateControl | undefined;
	const following = $derived(selectedId !== null);

	$effect(() => {
		const follow = following;
		if (!map || !maplibre) return;
		const m = map;
		untrack(() => {
			if (geolocate) {
				m.removeControl(geolocate);
				report(null);
			}
			// The button gets its label once MapLibre has checked, a moment later, that the browser
			// can locate at all, from the map's locale table: there's no option per control.
			m._locale['GeolocateControl.FindMyLocation'] = follow
				? FOLLOW_LABEL
				: LOCALE['GeolocateControl.FindMyLocation'];
			geolocate = follow ? followControl(maplibre!) : stationControl(maplibre!, m);
			m.addControl(geolocate, 'top-right');
		});
	});

	const FOLLOW_LABEL = 'Volg mijn locatie op de route';

	/** You're following yourself on the open walk: it's the only one that matters now. */
	let focused = $state(false);
	function report(here: Here | null) {
		focused = here !== null;
		onposition(here);
	}

	$effect(() => {
		void focused;
		void selectedId;
		if (ready && map) untrack(() => applyFocus(map!));
	});

	function stationControl(ml: typeof import('maplibre-gl'), m: MlMap) {
		const control = new ml.GeolocateControl({});
		control.on('geolocate', ({ coords }) => {
			const here: [number, number] = [coords.longitude, coords.latitude];
			const closest = nearest(here, stations, LOCATE_MAX_METRES);
			if (!closest) return; // the control has already flown to you; nothing to pick
			onlocate(closest.item.code);
			// Frame you and the station together, in place of the control's own fly-to-you.
			const station: [number, number] = [closest.item.lng, closest.item.lat];
			m.fitBounds(
				[
					[Math.min(here[0], station[0]), Math.min(here[1], station[1])],
					[Math.max(here[0], station[0]), Math.max(here[1], station[1])]
				],
				{ padding: panelPadding(56, true), maxZoom: 13, duration: 800 }
			);
		});
		return control;
	}

	function followControl(ml: typeof import('maplibre-gl')) {
		const control = new ml.GeolocateControl({
			trackUserLocation: true,
			positionOptions: { enableHighAccuracy: true },
			fitBoundsOptions: { padding: panelPadding(40), maxZoom: 16 }
		});
		control.on('geolocate', ({ coords, timestamp }) =>
			report({
				lng: coords.longitude,
				lat: coords.latitude,
				accuracyM: coords.accuracy,
				time: timestamp
			})
		);
		// Panning the map away from you ends the follow too, but keeps the dot and its fixes: only a
		// button that's no longer pressed means you've stopped. MapLibre unpresses it right after.
		control.on('trackuserlocationend', () =>
			queueMicrotask(() => {
				if (container.querySelector('.maplibregl-ctrl-geolocate[aria-pressed="false"]'))
					report(null);
			})
		);
		control.on('error', (e) => {
			if (e.code === GeolocationPositionError.PERMISSION_DENIED) report(null);
		});
		return control;
	}

	/** A route picked to plan on: show all of it, unless a walk is open (that frames itself). */
	$effect(() => {
		const lines = path?.lines;
		if (!ready || !map || !lines || untrack(() => selectedId)) return;
		fitTo(lines.flat());
	});

	function fitTo(points: [number, number][]) {
		const lngs = points.map((p) => p[0]);
		const lats = points.map((p) => p[1]);
		map?.fitBounds(
			[
				[Math.min(...lngs), Math.min(...lats)],
				[Math.max(...lngs), Math.max(...lats)]
			],
			{ padding: panelPadding(56, true), maxZoom: 14, duration: 800 }
		);
	}

	$effect(() => {
		if (!ready || !map) return;
		const filter = routeFilter();
		// Mid style swap the layers are briefly gone; addOverlay applies the filter then.
		if (!map.getLayer('routes-line')) return;
		if (routeKinds.length && !routesWanted) {
			routesWanted = true;
			(map.getSource('routes') as GeoJSONSource).setData('/api/paths');
		}
		for (const id of ['routes-line', 'routes-hit']) map.setFilter(id, filter);
	});

	// Only the filter: running a finger down the list shouldn't send the map flying around.
	$effect(() => {
		if (!ready || !map) return;
		const filter = hoveredFilter();
		// Mid style swap the layers are briefly gone; addOverlay applies the hover then.
		if (!map.getLayer('walks-hover')) return;
		for (const id of ['walks-hover-casing', 'walks-hover', 'walk-ends-hover'])
			map.setFilter(id, filter);
	});

	$effect(() => {
		if (!ready || !map) return;
		// Mid style swap the layers are briefly gone; addOverlay applies the selection then.
		if (map.getLayer('walks-selected')) {
			for (const id of ['walks-selected', 'walk-ends-selected', 'walk-ends-selected-labels'])
				map.setFilter(id, selectedFilter());
			map.setFilter('station-labels', stationLabelFilter());
		}
		const walk = walks.find((w) => w.id === selectedId);
		if (walk) fitTo(walk.geometry);
	});
</script>

<div class="map" bind:this={container} role="region" aria-label="Kaart met wandelroutes"></div>

<style>
	.map {
		position: absolute;
		inset: 0;
	}

	/* Small screens: the (i) button rides on the list's top edge, like the legend. */
	@media (max-width: 799px) {
		.map :global(.maplibregl-ctrl-bottom-right) {
			transform: translateY(calc(-1 * var(--sheet-cover, 0px)));
		}
	}
</style>
