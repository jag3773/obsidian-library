import { PersonName, displayName, familyOf } from "../names";
import { Fetcher, getJson } from "./http";
import { parseDate } from "./dates";
import { ReferenceData, joinTitle, stripTags, yearFrom } from "./types";

/** CSL / Crossref work types mapped to this plugin's type vocabulary. */
const TYPE_MAP: Record<string, string> = {
	"journal-article": "article",
	"article-journal": "article",
	"article-magazine": "article",
	"article-newspaper": "article",
	book: "book",
	monograph: "book",
	"edited-book": "book",
	"reference-book": "book",
	"book-chapter": "chapter",
	chapter: "chapter",
	"book-section": "chapter",
	"proceedings-article": "paper",
	"paper-conference": "paper",
	"posted-content": "paper",
	report: "report",
	dissertation: "thesis",
	thesis: "thesis",
	dataset: "document",
	"reference-entry": "reference",
	"entry-encyclopedia": "reference",
};

interface CslPerson {
	given?: string;
	family?: string;
	name?: string;
	literal?: string;
	"non-dropping-particle"?: string;
	"dropping-particle"?: string;
	suffix?: string;
}

interface CslWork {
	type?: string;
	title?: string | string[];
	subtitle?: string | string[];
	author?: CslPerson[];
	editor?: CslPerson[];
	translator?: CslPerson[];
	volume?: string | number;
	issue?: string | number;
	page?: string;
	edition?: string | number;
	"publisher-place"?: string;
	language?: string;
	/** A list from Crossref; a string in standard CSL-JSON (doi.org). */
	ISSN?: string | string[];
	"collection-title"?: string | string[];
	issued?: { "date-parts"?: number[][] };
	published?: { "date-parts"?: number[][] };
	"container-title"?: string | string[];
	publisher?: string;
	abstract?: string;
	URL?: string;
	ISBN?: string | string[];
	DOI?: string;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The first identifier from a list or a single string, either of which CSL-JSON may hold. */
function identifier(v: string | string[] | undefined): string | undefined {
	const s = first(v)?.trim();
	// A string may itself hold several ("0-14-312837-X 978-0-14-312837-3").
	return s ? s.split(/[\s,;]+/)[0] : undefined;
}

/** A CSL name, keeping its parts; organizations and single-field names stay whole. */
function personName(p: CslPerson): PersonName {
	const literal = p.literal ?? p.name;
	if (literal && !p.family) return { literal: literal.trim() };
	return {
		given: p.given?.trim() || undefined,
		family: p.family?.trim() || undefined,
		particle: (p["non-dropping-particle"] ?? p["dropping-particle"])?.trim() || undefined,
		suffix: p.suffix?.trim() || undefined,
	};
}

export function parseCsl(work: CslWork | null, doi: string, source: string): ReferenceData | null {
	if (!work) return null;
	const title = first(work.title);
	if (!title) return null;
	const people = (list: CslPerson[] | undefined) => {
		const parts = (list ?? []).map(personName).filter((n) => n.literal || n.family);
		return { display: parts.map(displayName), parts };
	};
	const authors = people(work.author);
	const editors = people(work.editor);
	const translators = people(work.translator);
	const type = TYPE_MAP[work.type ?? ""] ?? "article";
	const text = (v: string | number | undefined) => (v === undefined || v === null || v === "" ? undefined : String(v).trim() || undefined);
	const dateParts = work.issued?.["date-parts"]?.[0] ?? work.published?.["date-parts"]?.[0];
	return {
		type,
		title: joinTitle(title, first(work.subtitle)),
		authors: authors.display,
		// An edited volume's citekey uses its editors.
		familyNames: (authors.parts.length ? authors.parts : editors.parts).map(familyOf),
		editors: editors.display.length ? editors.display : undefined,
		translators: translators.display.length ? translators.display : undefined,
		names: { authors: authors.parts, editors: editors.parts, translators: translators.parts },
		date: dateParts?.length ? parseDate(dateParts.slice(0, 3).join("-")) : undefined,
		year: yearFrom(dateParts?.[0]),
		// For a chapter, the container is the book; for an article, the journal.
		journal: type === "book" ? undefined : first(work["container-title"]),
		volume: text(work.volume),
		issue: text(work.issue),
		pages: text(work.page),
		edition: text(work.edition),
		place: text(work["publisher-place"]),
		series: text(first(work["collection-title"])),
		language: text(work.language),
		issn: identifier(work.ISSN),
		publisher: work.publisher,
		abstract: stripTags(work.abstract),
		isbn: identifier(work.ISBN)?.replace(/-/g, ""),
		doi: work.DOI ?? doi,
		url: work.URL && /^https?:\/\//i.test(work.URL) ? work.URL : undefined,
		source,
	};
}

export async function lookupCrossref(fetch: Fetcher, doi: string, mailto?: string): Promise<ReferenceData | null> {
	const q = mailto ? `?mailto=${encodeURIComponent(mailto)}` : "";
	const json = await getJson<{ message: CslWork }>(fetch, `https://api.crossref.org/works/${encodeURIComponent(doi)}${q}`);
	return parseCsl(json?.message ?? null, doi, "Crossref");
}

/** doi.org content negotiation works for DataCite and other registrars too. */
export async function lookupDoiOrg(fetch: Fetcher, doi: string): Promise<ReferenceData | null> {
	const json = await getJson<CslWork>(fetch, `https://doi.org/${encodeURIComponent(doi)}`, {
		Accept: "application/vnd.citationstyles.csl+json",
	});
	return parseCsl(json, doi, "doi.org");
}
