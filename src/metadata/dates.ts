/** Pure module: publication dates as the pages and APIs write them, normalized to ISO. */

const MONTHS: Record<string, number> = {
	jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const pad = (n: number) => String(n).padStart(2, "0");
const okYear = (y: number) => y >= 1000 && y <= 2099;

/** The most precise valid form of year, month and day: YYYY-MM-DD, YYYY-MM or YYYY. */
function iso(y: number, m?: number, d?: number): string | undefined {
	if (!okYear(y)) return undefined;
	if (!m || m < 1 || m > 12) return String(y);
	const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
	const max = m === 2 && !leap ? 28 : DAYS_IN[m - 1];
	if (!d || d < 1 || d > max) return `${y}-${pad(m)}`;
	return `${y}-${pad(m)}-${pad(d)}`;
}

const month = (name: string) => MONTHS[name.toLowerCase().slice(0, 3)];

/**
 * A publication date as "YYYY-MM-DD", "YYYY-MM" or "YYYY", or undefined when none is found.
 * Numbers are epoch milliseconds (read as UTC). ISO strings keep their written calendar date
 * rather than converting time zones, so "2021-05-04T00:00:00-07:00" stays May 4.
 */
export function parseDate(v: string | number | undefined | null): string | undefined {
	if (v === undefined || v === null) return undefined;
	if (typeof v === "number") {
		if (!Number.isFinite(v)) return undefined;
		const d = new Date(v);
		return Number.isNaN(d.getTime()) ? undefined : iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
	}
	const s = String(v).trim();
	let m = s.match(/\b(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?!\d)/);
	if (m) return iso(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
	const name = "(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?";
	// "May 4, 2021", "May 04 2021"
	m = s.match(new RegExp(`\\b${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i"));
	if (m) return iso(Number(m[3]), month(m[1]), Number(m[2]));
	// "4 May 2021"
	m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${name}\\s+(\\d{4})\\b`, "i"));
	if (m) return iso(Number(m[3]), month(m[2]), Number(m[1]));
	// "March 2019"
	m = s.match(new RegExp(`\\b${name}\\s+(\\d{4})\\b`, "i"));
	if (m) return iso(Number(m[2]), month(m[1]));
	m = s.match(/\b(1\d{3}|20\d{2})\b/);
	return m ? iso(Number(m[1])) : undefined;
}

/** The year of an ISO date from parseDate. */
export function yearOf(date: string | undefined): number | undefined {
	const y = Number(date?.slice(0, 4));
	return okYear(y) ? y : undefined;
}
