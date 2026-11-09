/**
 * Pure module: CSL-JSON (the format Pandoc, Quarto, Zotero and Better BibTeX write) as import
 * records (#17). The reverse of src/citation.ts; docs/importing.md lists what is read.
 */
import { canonicalIsbn, normalizeDoi } from "../identifiers";
import { parseDate, yearOf } from "../metadata/dates";
import { ReferenceData } from "../metadata/types";
import { PersonName, displayName, familyOf } from "../names";
import { Diagnostic, ImportRecord, ParseResult, splitKeywords, str } from "./record";

/** CSL types as the plugin's types. */
export const CSL_TO_TYPE: Record<string, string> = {
	article: "article",
	"article-journal": "article",
	"article-magazine": "article",
	"article-newspaper": "article",
	"post-weblog": "article",
	periodical: "article",
	book: "book",
	classic: "book",
	collection: "book",
	chapter: "chapter",
	"paper-conference": "paper",
	report: "report",
	thesis: "thesis",
	webpage: "webpage",
	post: "webpage",
	motion_picture: "video",
	broadcast: "video",
	song: "audio",
	software: "software",
	speech: "presentation",
	graphic: "image",
	map: "image",
	figure: "image",
	"entry-encyclopedia": "reference",
	"entry-dictionary": "reference",
	entry: "reference",
	document: "document",
	manuscript: "document",
	personal_communication: "document",
	interview: "document",
	dataset: "document",
	standard: "document",
	patent: "document",
	legal_case: "document",
	legislation: "document",
	bill: "document",
	pamphlet: "document",
	review: "document",
	"review-book": "document",
	event: "document",
	performance: "document",
	musical_score: "document",
	regulation: "document",
	treaty: "document",
	hearing: "document",
};

/** Creator fields, in the order they fill a role. The first with names in `authors` is the record's primary creators. */
const PRIMARY = ["author", "director", "composer", "performer", "interviewer", "creator"];
const OTHER_PEOPLE = ["illustrator", "narrator", "compiler", "contributor", "editorial-director", "curator", "host", "organizer", "producer", "recipient", "guest"];

/** Fields read, and ones that are bookkeeping rather than metadata. */
const MAPPED = new Set([
	"id", "citation-key", "type", "title", "title-short", "issued", "accessed", "container-title", "container-title-short", "collection-title", "publisher",
	"publisher-place", "volume", "issue", "page", "edition", "ISBN", "ISSN", "DOI", "URL", "language", "abstract", "keyword", "note",
	"editor", "translator", "collection-editor", ...PRIMARY, ...OTHER_PEOPLE,
]);
const BOOKKEEPING = new Set(["source", "journalAbbreviation", "shortTitle", "number-of-pages", "page-first", "system_id", "_graph", "custom"]);

export interface CslNameIn {
	family?: unknown;
	given?: unknown;
	literal?: unknown;
	"non-dropping-particle"?: unknown;
	"dropping-particle"?: unknown;
	suffix?: unknown;
}

/** A CSL name as the plugin's name. */
export function cslName(n: unknown): PersonName | undefined {
	if (typeof n === "string") return n.trim() ? { literal: n.trim() } : undefined;
	if (!n || typeof n !== "object") return undefined;
	const c = n as CslNameIn;
	const literal = str(c.literal);
	if (literal) return { literal };
	const family = str(c.family);
	const given = str(c.given);
	const particle = [str(c["dropping-particle"]), str(c["non-dropping-particle"])].filter(Boolean).join(" ") || undefined;
	if (!family) return given ? { literal: given } : undefined;
	const out: PersonName = { family };
	if (given) out.given = given;
	if (particle) out.particle = particle;
	const suffix = str(c.suffix);
	if (suffix) out.suffix = suffix;
	return out;
}

/** A CSL date ({"date-parts": [[2021, 5, 4]]}, {raw: "..."}, {literal: "..."}, or a string) as ISO. */
export function cslDateToIso(v: unknown): string | undefined {
	if (typeof v === "string" || typeof v === "number") return parseDate(String(v));
	if (!v || typeof v !== "object") return undefined;
	const d = v as { "date-parts"?: unknown; raw?: unknown; literal?: unknown; season?: unknown };
	const parts = Array.isArray(d["date-parts"]) ? (d["date-parts"][0] as unknown) : undefined;
	if (Array.isArray(parts) && parts.length) {
		const [y, m, day] = parts.map((x) => Number(x));
		if (Number.isFinite(y)) {
			const pad = (n: number) => String(n).padStart(2, "0");
			return parseDate(m ? (day ? `${y}-${pad(m)}-${pad(day)}` : `${y}-${pad(m)}`) : String(y));
		}
	}
	return parseDate(str(d.raw) ?? str(d.literal));
}

/** A Zotero item key in a CSL id written by Zotero ("http://zotero.org/users/1/items/ABCD2345"). */
const ZOTERO_URI = /^https?:\/\/zotero\.org\/(?:users|groups)\/\w+\/items\/([A-Z0-9]{8})$/;

/** One CSL item as an import record. `index` (from 1) names records without an id. */
export function cslItemToRecord(item: Record<string, unknown>, index: number, diagnostics: Diagnostic[]): ImportRecord {
	const rawId = str(item["citation-key"]) ?? str(item.id);
	const zoteroKey = rawId?.match(ZOTERO_URI)?.[1];
	// A Zotero URI or a bare number is a database id, not a citekey.
	const citekey = rawId && !zoteroKey && !/^\d+$/.test(rawId) && !/\s/.test(rawId) ? rawId : undefined;
	const label = citekey ?? `record ${index}`;
	const problem = (p: string) => diagnostics.push({ record: label, problem: p });
	if (!rawId) problem("no id; a citekey is made from the pattern in settings");
	else if (!citekey) problem(`id "${rawId}" isn't a citekey; one is made from the pattern in settings`);

	const cslType = str(item.type) ?? "";
	let type = CSL_TO_TYPE[cslType];
	if (!type) {
		problem(cslType ? `type "${cslType}" imported as a document` : "no type; imported as a document");
		type = "document";
	}
	const cache = new Map<string, PersonName[]>();
	const people = (k: string): PersonName[] => {
		if (!cache.has(k)) cache.set(k, readPeople(k));
		return cache.get(k)!;
	};
	const readPeople = (k: string): PersonName[] => {
		const v = item[k];
		if (v === undefined) return [];
		if (!Array.isArray(v)) {
			problem(`${k} isn't a list of names`);
			return [];
		}
		const out = v.map(cslName).filter((n): n is PersonName => !!n);
		if (out.length < v.length) problem(`${v.length - out.length} unreadable name${v.length - out.length === 1 ? "" : "s"} in ${k}`);
		return out;
	};
	const primaryKey = PRIMARY.find((k) => people(k).length);
	const authors = primaryKey ? people(primaryKey) : [];
	const editors = [...people("editor"), ...(type === "book" ? people("collection-editor") : [])];
	const translators = people("translator");
	const contributors = [...PRIMARY.filter((k) => k !== primaryKey), ...OTHER_PEOPLE].flatMap((k) => people(k));
	const list = (n: PersonName[]) => (n.length ? n.map(displayName) : undefined);
	const title = str(item.title) ?? "";
	if (!title) problem("no title");
	const date = cslDateToIso(item.issued);
	if (item.issued !== undefined && !date) problem("issued date can't be read");
	const doi = str(item.DOI);
	const isbn = str(item.ISBN)
		?.split(/[\s,;]+/)
		.map((s) => canonicalIsbn(s))
		.find(Boolean);
	const data: ReferenceData = {
		type,
		title,
		authors: authors.map(displayName),
		familyNames: (authors.length ? authors : editors).map(familyOf),
		editors: list(editors),
		translators: list(translators),
		contributors: list(contributors),
		names: { authors, editors, translators, contributors },
		date,
		year: yearOf(date),
		publisher: str(item.publisher),
		place: str(item["publisher-place"]),
		journal: str(item["container-title"]),
		volume: str(item.volume),
		issue: str(item.issue),
		pages: str(item.page),
		edition: str(item.edition),
		series: str(item["collection-title"]),
		language: str(item.language),
		isbn: isbn ?? undefined,
		issn: str(item.ISSN),
		doi: doi ? normalizeDoi(doi) ?? undefined : undefined,
		url: str(item.URL),
		accessed: cslDateToIso(item.accessed),
		abstract: str(item.abstract),
		source: "CSL-JSON",
	};
	for (const k of Object.keys(data) as (keyof ReferenceData)[]) if (data[k] === undefined) delete data[k];
	const keywords = Array.isArray(item.keyword) ? item.keyword.map(str).filter((k): k is string => !!k) : splitKeywords(str(item.keyword));
	return {
		label,
		citekey,
		zoteroKey,
		sourceType: cslType || "(none)",
		data,
		tags: keywords.map((tag) => ({ tag })),
		collections: [],
		attachments: [],
		notes: str(item.note) ? [str(item.note)!] : [],
		unmapped: Object.keys(item).filter((k) => !MAPPED.has(k) && !BOOKKEEPING.has(k) && (str(item[k]) !== undefined || (typeof item[k] === "object" && item[k] !== null))),
	};
}

/**
 * Parse CSL-JSON: an array of items, one item, or {"items": [...]}. Invalid JSON throws;
 * items that aren't objects are reported and skipped, and so is a second item with an id
 * already used.
 */
export function parseCslJson(text: string): ParseResult {
	let data: unknown;
	try {
		data = JSON.parse(text.replace(/^\uFEFF/, ""));
	} catch (e) {
		throw new Error(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
	}
	const items: unknown[] = Array.isArray(data)
		? data
		: data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
			? ((data as { items: unknown[] }).items)
			: data && typeof data === "object"
				? [data]
				: [];
	if (!items.length && !Array.isArray(data)) throw new Error("Not CSL-JSON: expected a list of items.");
	const diagnostics: Diagnostic[] = [];
	const records: ImportRecord[] = [];
	const seen = new Set<string>();
	items.forEach((item, i) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			diagnostics.push({ record: `record ${i + 1}`, problem: "not an object; skipped" });
			return;
		}
		const r = cslItemToRecord(item as Record<string, unknown>, i + 1, diagnostics);
		if (r.citekey) {
			if (seen.has(r.citekey.toLowerCase())) {
				diagnostics.push({ record: r.label, problem: `id used by an earlier record; record ${i + 1} skipped` });
				return;
			}
			seen.add(r.citekey.toLowerCase());
		}
		records.push(r);
	});
	return { records, diagnostics };
}
