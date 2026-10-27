/**
 * Which way the phone points, degrees clockwise from north. iOS gives it as `webkitCompassHeading`,
 * and only after a tap that asks for it; Chrome on Android as the absolute orientation's `alpha`,
 * counted the other way round. Both are of the phone's top edge, so a phone held sideways adds the
 * screen's own turn. A laptop has none: the callback just never runs.
 */

type OrientationEventIOS = DeviceOrientationEvent & { webkitCompassHeading?: number };
type PermissionAsking = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Ask for the compass where the browser wants that (iOS): call it from a tap. False: refused. */
export async function askCompass(): Promise<boolean> {
	// Called on the class itself: Safari won't have it lifted off.
	const orientation = globalThis.DeviceOrientationEvent as PermissionAsking | undefined;
	if (!orientation?.requestPermission) return true;
	try {
		return (await orientation.requestPermission()) === 'granted';
	} catch {
		return false;
	}
}

/** Smoothing: each reading moves the heading this far towards it. A compass jitters. */
const SMOOTHING = 0.25;
/** Don't bother the map for less than this. */
const MIN_CHANGE_DEG = 2;

/** Follow the compass; the returned function stops. */
export function watchCompass(onHeading: (degrees: number) => void): () => void {
	let x: number | null = null;
	let y = 0;
	let shown: number | null = null;
	const screenTurn = () => screen.orientation?.angle ?? 0;

	function reading(degrees: number) {
		const r = (degrees * Math.PI) / 180;
		// Averaged as a direction, not a number: 359° and 1° make north, not south.
		if (x === null) [x, y] = [Math.cos(r), Math.sin(r)];
		else [x, y] = [x + SMOOTHING * (Math.cos(r) - x), y + SMOOTHING * (Math.sin(r) - y)];
		const heading = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
		const change = shown === null ? 360 : Math.abs(((heading - shown + 540) % 360) - 180);
		if (change < MIN_CHANGE_DEG) return;
		shown = heading;
		onHeading(heading);
	}

	const ios = (e: Event) => {
		const heading = (e as OrientationEventIOS).webkitCompassHeading;
		if (typeof heading === 'number' && heading >= 0) reading(heading + screenTurn());
	};
	const absolute = (e: Event) => {
		const { alpha } = e as DeviceOrientationEvent;
		if (alpha !== null) reading(360 - alpha + screenTurn());
	};
	const absoluteKind = 'ondeviceorientationabsolute' in window;
	if (absoluteKind) window.addEventListener('deviceorientationabsolute', absolute);
	else window.addEventListener('deviceorientation', ios);
	return () => {
		window.removeEventListener('deviceorientationabsolute', absolute);
		window.removeEventListener('deviceorientation', ios);
	};
}
