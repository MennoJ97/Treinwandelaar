/** One CSV line → fields. Handles quoted fields with commas and doubled quotes (GTFS style). */
export function parseCsvLine(line: string): string[] {
	if (!line.includes('"')) return line.split(',');
	const out: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quoted) {
			if (ch === '"' && line[i + 1] === '"') {
				field += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else field += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') {
			out.push(field);
			field = '';
		} else field += ch;
	}
	out.push(field);
	return out;
}

/** "25:10:00" → seconds after midnight (GTFS times run past 24:00 for trips after midnight). */
export function gtfsTime(value: string): number {
	const [h, m, s] = value.split(':').map(Number);
	return h * 3600 + m * 60 + (s || 0);
}
