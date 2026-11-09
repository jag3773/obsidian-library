/** Normalized metadata returned by every source. */
export interface ReferenceData {
	type: string;
	title: string;
	/** Display names, "First Last" order. */
	authors: string[];
	/** Family names, same order as authors; used for citekeys. */
	familyNames: string[];
	/** Publication date, ISO: YYYY-MM-DD, YYYY-MM or YYYY. */
	date?: string;
	year?: number;
	publisher?: string;
	journal?: string;
	isbn?: string;
	doi?: string;
	url?: string;
	abstract?: string;
	/** Where the data came from, for messages. */
	source: string;
}

export function yearFrom(s: string | number | undefined | null): number | undefined {
	if (s === undefined || s === null) return undefined;
	const m = String(s).match(/\b(1\d{3}|20\d{2})\b/);
	return m ? Number(m[1]) : undefined;
}

export function stripTags(html: string | undefined): string | undefined {
	if (!html) return undefined;
	const t = html
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
	return t || undefined;
}

export function joinTitle(title: string | undefined, subtitle: string | undefined): string {
	const t = (title ?? "").trim();
	const s = (subtitle ?? "").trim();
	return s && !t.toLowerCase().includes(s.toLowerCase()) ? `${t}: ${s}` : t;
}
