/**
 * Pure module: a bibliography from reference notes, as CSL-JSON, BibLaTeX or BibTeX.
 * Output is deterministic (entries sorted by citekey, fields in a fixed order) so a file
 * kept in git changes only where the library did.
 */
import { CslDate, CslItem, CslName, missingFields, noteToCsl } from "./citation";
import { PropertyKey } from "./properties";
import { asText } from "./text";

export type BibFormat = "csl-json" | "biblatex" | "bibtex";

export const FORMAT_LABELS: Record<BibFormat, string> = {
	"csl-json": "CSL-JSON (Pandoc, Quarto, Zotero)",
	biblatex: "BibLaTeX",
	bibtex: "BibTeX",
};

export const FORMAT_EXTENSIONS: Record<BibFormat, string> = { "csl-json": "json", biblatex: "bib", bibtex: "bib" };

/** Only notes whose property holds one of the values (any, for a list). Empty: every note. */
export interface BibFilter {
	property: string;
	values: string[];
}

export interface BibSource {
	path: string;
	frontmatter: Record<string, unknown>;
}

export interface BibProblem {
	path: string;
	citekey?: string;
	problem: string;
}

export interface Bibliography {
	items: CslItem[];
	problems: BibProblem[];
	/** Notes left out by the filter. */
	filtered: number;
}

const plain = (v: unknown) =>
	asText(v)
		.replace(/^\[\[([^\]|]*)(?:\|[^\]]*)?\]\]$/, "$1")
		.trim()
		.toLowerCase();

/** True when the note's property holds one of the filter's values. */
export function matchesFilter(fm: Record<string, unknown>, filter: BibFilter | undefined): boolean {
	if (!filter || !filter.property.trim() || !filter.values.some((v) => v.trim())) return true;
	const raw = fm[filter.property.trim()];
	const have = (Array.isArray(raw) ? raw : [raw]).map(plain).filter(Boolean);
	const want = filter.values.map(plain).filter(Boolean);
	return have.some((h) => want.includes(h));
}

/** Parse "status: queued, reading" into a filter. */
export function parseFilter(s: string): BibFilter | undefined {
	const m = s.match(/^\s*([^:]+):(.*)$/);
	if (!m) return undefined;
	const values = m[2].split(",").map((v) => v.trim()).filter(Boolean);
	return values.length ? { property: m[1].trim(), values } : undefined;
}

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Citation records for the notes, sorted by citekey, with what's wrong reported: no
 * citekey, a citekey used twice (the first note by path wins), a key BibTeX can't use,
 * or fields the type needs.
 */
export function buildBibliography(sources: BibSource[], p: Record<PropertyKey, string>, filter?: BibFilter): Bibliography {
	const problems: BibProblem[] = [];
	const seen = new Map<string, string>();
	const items: CslItem[] = [];
	let filtered = 0;
	for (const src of [...sources].sort((a, b) => byKey(a.path, b.path))) {
		if (!matchesFilter(src.frontmatter, filter)) {
			filtered++;
			continue;
		}
		const item = noteToCsl(src.frontmatter, p);
		if (!item) {
			problems.push({ path: src.path, problem: "no citekey; left out" });
			continue;
		}
		const lower = item.id.toLowerCase();
		const first = seen.get(lower);
		if (first) {
			problems.push({ path: src.path, citekey: item.id, problem: `citekey also used by ${first}; left out` });
			continue;
		}
		seen.set(lower, src.path);
		if (!/^[^\s,{}()"#%'=~\\]+$/.test(item.id)) problems.push({ path: src.path, citekey: item.id, problem: "citekey has characters BibTeX can't use" });
		const missing = missingFields(item);
		if (missing.length) problems.push({ path: src.path, citekey: item.id, problem: `missing ${missing.join(", ")}` });
		items.push(item);
	}
	items.sort((a, b) => byKey(a.id, b.id));
	return { items, problems, filtered };
}

export function render(items: CslItem[], format: BibFormat): string {
	return format === "csl-json" ? toCslJson(items) : toBib(items, format);
}

export function toCslJson(items: CslItem[]): string {
	return JSON.stringify(items, null, 2) + "\n";
}

// BibLaTeX / BibTeX --------------------------------------------------------------------------

const BIBLATEX_TYPES: Record<string, string> = {
	book: "book",
	chapter: "incollection",
	"article-journal": "article",
	"article-magazine": "article",
	"article-newspaper": "article",
	"paper-conference": "inproceedings",
	report: "report",
	thesis: "thesis",
	webpage: "online",
	software: "software",
	motion_picture: "video",
	song: "audio",
	"entry-encyclopedia": "inreference",
	graphic: "artwork",
};

const BIBTEX_TYPES: Record<string, string> = {
	book: "book",
	chapter: "incollection",
	"article-journal": "article",
	"article-magazine": "article",
	"article-newspaper": "article",
	"paper-conference": "inproceedings",
	report: "techreport",
	thesis: "phdthesis",
};

/** Escape LaTeX's special characters; Unicode is kept (BibLaTeX and Biber read UTF-8). */
export function tex(s: string): string {
	return s
		.replace(/\\/g, "\u0000")
		.replace(/([{}&%$#_])/g, "\\$1")
		.replace(/~/g, "\\textasciitilde{}")
		.replace(/\^/g, "\\textasciicircum{}")
		.split("\u0000")
		.join("\\textbackslash{}")
		.replace(/\s+/g, " ")
		.trim();
}

/** A title with acronyms and other mixed-case words braced, so styles don't lower-case them. */
function texTitle(s: string): string {
	return tex(s)
		.split(" ")
		// Two capitals in the word, ignoring escape commands: "NASA", "R\&D", "McDonald".
		.map((w) => (/[A-Z].*[A-Z]/.test(w.replace(/\\[a-z]+\{\}|\\./g, "")) ? `{${w}}` : w))
		.join(" ");
}

function texName(n: CslName): string {
	if (n.literal) return `{${tex(n.literal)}}`;
	const family = tex([n["non-dropping-particle"], n.family].filter(Boolean).join(" "));
	const parts = [family];
	if (n.suffix) parts.push(tex(n.suffix));
	if (n.given) parts.push(tex(n.given));
	return parts.join(", ");
}

const names = (list: CslName[] | undefined) => (list?.length ? list.map(texName).join(" and ") : undefined);

const isoDate = (d: CslDate | undefined) => {
	const parts = d?.["date-parts"]?.[0];
	return parts?.length ? parts.map((n, i) => (i ? String(n).padStart(2, "0") : String(n))).join("-") : undefined;
};

const pages = (s: string | undefined) => (s ? tex(s.replace(/\s*[-–—]+\s*/g, "--")) : undefined);

function bibEntry(item: CslItem, format: "biblatex" | "bibtex"): string {
	const bl = format === "biblatex";
	const type = (bl ? BIBLATEX_TYPES : BIBTEX_TYPES)[item.type] ?? "misc";
	const t = (v: string | undefined) => (v ? tex(v) : undefined);
	const container = item["container-title"];
	const isArticle = type === "article";
	const inBook = type === "incollection" || type === "inproceedings" || type === "inreference";
	const institution = type === "thesis" || type === "phdthesis" || type === "report" || type === "techreport";
	const issued = item.issued?.["date-parts"]?.[0];
	const fields: [string, string | undefined][] = [
		["author", names(item.author)],
		["editor", names(item.editor)],
		["translator", bl ? names(item.translator) : undefined],
		["title", item.title ? texTitle(item.title) : undefined],
		// The container: a journal, a chapter's or paper's book, a web page's site.
		[isArticle ? (bl ? "journaltitle" : "journal") : inBook ? "booktitle" : type === "online" ? "organization" : "howpublished", t(container)],
		...(bl
			? ([["date", isoDate(item.issued)]] as [string, string | undefined][])
			: ([
					["year", issued?.[0] ? String(issued[0]) : undefined],
					["month", issued?.[1] ? String(issued[1]) : undefined],
				] as [string, string | undefined][])),
		["volume", t(item.volume)],
		["number", t(item.issue)],
		["pages", pages(item.page)],
		["edition", t(item.edition)],
		["series", t(item["collection-title"])],
		[institution ? (bl ? "institution" : type === "phdthesis" ? "school" : "institution") : "publisher", t(item.publisher)],
		[bl ? "location" : "address", t(item["publisher-place"])],
		["isbn", t(item.ISBN)],
		["issn", t(item.ISSN)],
		// DOIs and URLs are verbatim fields: not escaped, only kept free of braces.
		["doi", item.DOI?.replace(/[{}]/g, "")],
		["url", item.URL?.replace(/[{}]/g, "")],
		["urldate", bl ? isoDate(item.accessed) : undefined],
		[bl ? "langid" : "language", t(item.language)],
		["abstract", t(item.abstract)],
	];
	const body = fields
		.filter(([, v]) => v !== undefined && v !== "")
		.map(([k, v]) => `  ${k} = {${v}},`)
		.join("\n");
	return `@${type}{${item.id},\n${body}\n}`;
}

export function toBib(items: CslItem[], format: "biblatex" | "bibtex"): string {
	return items.map((i) => bibEntry(i, format)).join("\n\n") + (items.length ? "\n" : "");
}
