/**
 * Pure module: citations written into notes. Searching reference notes for the picker,
 * the citation text inserted ([[key]], [@key] or both), adding a key to a Pandoc citation
 * already at the cursor, and finding the citekeys a draft cites. Nothing here imports Obsidian.
 */
import { familyOf, namesFromProperty } from "./names";
import { PropertyKey } from "./properties";
import { asText } from "./text";

/** How an inserted citation is written. */
export type CiteFormat = "wikilink" | "pandoc" | "both";

export const CITE_FORMAT_LABELS: Record<CiteFormat, string> = {
	wikilink: "Link: [[citekey]]",
	pandoc: "Pandoc: [@citekey]",
	both: "Both: [@citekey] [[citekey]]",
};

/** A reference note as the picker shows and searches it. */
export interface CiteRef {
	key: string;
	title: string;
	/** Family names (or an organization's name), joined with ", ". */
	authors: string;
	year: string;
	path: string;
}

const plain = (v: unknown) =>
	asText(Array.isArray(v) ? v[0] : v)
		.replace(/^\[\[([^\]|]*)(?:\|[^\]]*)?\]\]$/, "$1")
		.trim();

/** A note's citekey, title, authors and year, or undefined without a citekey. */
export function citeRef(fm: Record<string, unknown>, p: Record<PropertyKey, string>, path: string): CiteRef | undefined {
	const key = plain(fm[p.citekey]);
	if (!key) return undefined;
	const people = namesFromProperty(fm[p.authors]);
	const names = (people.length ? people : namesFromProperty(fm[p.editors])).map(familyOf).filter(Boolean);
	const year = plain(fm[p.year]) || (plain(fm[p.published]).match(/^\d{4}/)?.[0] ?? "");
	return { key, title: plain(fm[p.title]), authors: names.join(", "), year, path };
}

/** Lowercase, without accents, so "garcia" finds "García". */
const fold = (s: string) =>
	s
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase();

/**
 * Score a reference against a query; undefined when some word of the query isn't found.
 * Each query word must appear in the citekey, title, authors or year. Citekey prefixes
 * rank first, then author and year matches, then title words.
 */
export function scoreRef(ref: CiteRef, query: string): number | undefined {
	const words = fold(query).split(/\s+/).filter(Boolean);
	if (!words.length) return 0;
	const key = fold(ref.key);
	const authors = fold(ref.authors);
	const title = fold(ref.title);
	let score = 0;
	for (const w of words) {
		if (key.startsWith(w)) score += 8;
		else if (ref.year === w) score += 6;
		else if (new RegExp(`(^|[^\\p{L}])${escape(w)}`, "u").test(authors)) score += 5;
		else if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}`, "u").test(title)) score += 3;
		else if (key.includes(w)) score += 2;
		else if (authors.includes(w) || title.includes(w) || ref.year.includes(w)) score += 1;
		else return undefined;
	}
	return score;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** References matching the query, best first; ties keep newest years, then citekey order. */
export function searchRefs(refs: CiteRef[], query: string, limit = 50): CiteRef[] {
	const scored: { ref: CiteRef; score: number }[] = [];
	for (const ref of refs) {
		const score = scoreRef(ref, query);
		if (score !== undefined) scored.push({ ref, score });
	}
	scored.sort((a, b) => b.score - a.score || b.ref.year.localeCompare(a.ref.year) || a.ref.key.localeCompare(b.ref.key));
	return scored.slice(0, limit).map((s) => s.ref);
}

/** One reference in a citation being inserted. `link` is the link text Obsidian resolves to the note. */
export interface CiteChoice {
	key: string;
	link?: string;
	locator?: string;
}

/** A locator as Pandoc reads it: a bare number is a page ("12" → "p. 12"). */
export function pandocLocator(raw: string | undefined): string {
	const s = (raw ?? "").trim();
	if (!s) return "";
	return /^\d[\d\s,–-]*$/.test(s) ? `${/[-–,]/.test(s) ? "pp." : "p."} ${s}` : s;
}

/** Pandoc's form of one key: @key, or @{key} when the key has characters Pandoc would stop at. */
export function pandocKey(key: string): string {
	return /^[\p{L}\p{N}_](?:[\p{L}\p{N}_:.#$%&\-+?<>~/]*[\p{L}\p{N}_])?$/u.test(key) ? `@${key}` : `@{${key}}`;
}

/** One cite inside Pandoc brackets: "@key, p. 12". */
const pandocCite = (c: CiteChoice) => {
	const loc = pandocLocator(c.locator);
	return loc ? `${pandocKey(c.key)}, ${loc}` : pandocKey(c.key);
};

/** "[[link|key]]", or "[[key]]" when the note is reached by its citekey. */
const wikilink = (c: CiteChoice) => {
	const link = c.link ?? c.key;
	return link === c.key ? `[[${c.key}]]` : `[[${link}|${c.key}]]`;
};

/** The text to insert for one or more references. */
export function formatCite(choices: CiteChoice[], format: CiteFormat): string {
	if (!choices.length) return "";
	const pandoc = `[${choices.map(pandocCite).join("; ")}]`;
	const links = choices
		.map((c) => {
			const loc = c.locator?.trim();
			return loc ? `${wikilink(c)}, ${pandocLocator(loc)}` : wikilink(c);
		})
		.join("; ");
	if (format === "pandoc") return pandoc;
	if (format === "wikilink") return links;
	return `${pandoc} ${choices.map(wikilink).join(" ")}`;
}

/**
 * The Pandoc citation ("[...@key...]") around a cursor position in a line, as the column of
 * its closing bracket, or undefined when the cursor isn't inside one.
 */
export function pandocCitationAt(line: string, ch: number): { start: number; end: number } | undefined {
	for (const m of line.matchAll(/\[[^[\]]*-?@[^[\]]*\]/g)) {
		const start = m.index ?? 0;
		const end = start + m[0].length - 1;
		if (ch > start && ch <= end) return { start, end };
	}
	return undefined;
}

/** What to insert before the closing bracket to add more references to a Pandoc citation. */
export function appendToPandoc(choices: CiteChoice[]): string {
	return choices.map((c) => `; ${pandocCite(c)}`).join("");
}

/** Code blocks and spans blanked out, so offsets still line up but nothing inside them counts. */
const maskCode = (text: string) => text.replace(/```[\s\S]*?```|`[^`\n]*`/g, (m) => " ".repeat(m.length));

/** Link targets of a draft's wikilinks and embeds ("[[target#heading|alias]]" → "target"), in order. */
export function wikilinkTargetsIn(text: string): { target: string; offset: number }[] {
	const out: { target: string; offset: number }[] = [];
	for (const m of maskCode(text).matchAll(/\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
		const target = m[1].trim();
		if (target) out.push({ target, offset: m.index ?? 0 });
	}
	return out;
}

/**
 * Citekeys a draft cites with Pandoc syntax ([@key], @key, [-@key], @{key}), in order of
 * first appearance. Email addresses and code spans are skipped.
 */
export function pandocKeysIn(text: string): { key: string; offset: number }[] {
	const out: { key: string; offset: number }[] = [];
	const seen = new Set<string>();
	const masked = maskCode(text);
	// The character before the @ is matched rather than looked behind at, for older iOS.
	const re = /(^|[^\p{L}\p{N}_@.])-?@(?:\{([^}]+)\}|([\p{L}\p{N}_](?:[\p{L}\p{N}_:.#$%&\-+?<>~/]*[\p{L}\p{N}_])?))/gu;
	for (const m of masked.matchAll(re)) {
		const key = (m[2] ?? m[3]).trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push({ key, offset: (m.index ?? 0) + m[1].length });
	}
	return out;
}
