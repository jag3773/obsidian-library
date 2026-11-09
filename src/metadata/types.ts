import { PersonName } from "../names";

/** Normalized metadata returned by every source. Optional fields are set only when the source has them. */
export interface ReferenceData {
	type: string;
	title: string;
	/** Display names, "First Last" order. Primary creators only: never translators or narrators. */
	authors: string[];
	/** Family names used for citekeys: the authors', or the editors' when there are no authors. */
	familyNames: string[];
	editors?: string[];
	translators?: string[];
	/** Other credited people (narrators, contributors). */
	contributors?: string[];
	/**
	 * How each name splits, when the source says so (Crossref, Zotero), keyed like the lists
	 * above and in the same order. Without it, names are split by rule (src/names.ts).
	 */
	names?: Partial<Record<"authors" | "editors" | "translators" | "contributors", (PersonName | undefined)[]>>;
	place?: string;
	volume?: string;
	issue?: string;
	pages?: string;
	edition?: string;
	series?: string;
	issn?: string;
	language?: string;
	/** ISO date the web page was read. */
	accessed?: string;
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

/** Family names for citekeys: the authors', or the editors' when there are no authors. */
export function citekeyFamilies(authors: string[], editors: string[] = [], familyFromFullName: (n: string) => string): string[] {
	return (authors.length ? authors : editors).map(familyFromFullName);
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
