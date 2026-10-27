/** A CSS token's value as the page has it now (they change with the theme). */
export function cssVar(name: string) {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** OpenFreeMap style matching the page theme (--map-style is set per theme in +layout). */
export function styleUrl() {
	const style = cssVar('--map-style').replace(/['"]/g, '') || 'positron';
	return `https://tiles.openfreemap.org/styles/${style}`;
}
