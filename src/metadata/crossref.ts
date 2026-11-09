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
}

interface CslWork {
	type?: string;
	title?: string | string[];
	subtitle?: string | string[];
	author?: CslPerson[];
	editor?: CslPerson[];
	issued?: { "date-parts"?: number[][] };
	published?: { "date-parts"?: number[][] };
	"container-title"?: string | string[];
	publisher?: string;
	abstract?: string;
	URL?: string;
	ISBN?: string[];
	DOI?: string;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseCsl(work: CslWork | null, doi: string, source: string): ReferenceData | null {
	if (!work) return null;
	const title = first(work.title);
	if (!title) return null;
	const people = work.author?.length ? work.author : work.editor ?? [];
	const authors = people.map((p) => p.name ?? p.literal ?? [p.given, p.family].filter(Boolean).join(" ")).filter(Boolean);
	const familyNames = people.map((p) => p.family ?? p.name ?? p.literal ?? "").filter(Boolean);
	const type = TYPE_MAP[work.type ?? ""] ?? "article";
	const dateParts = work.issued?.["date-parts"]?.[0] ?? work.published?.["date-parts"]?.[0];
	return {
		type,
		title: joinTitle(title, first(work.subtitle)),
		authors,
		familyNames,
		date: dateParts?.length ? parseDate(dateParts.slice(0, 3).join("-")) : undefined,
		year: yearFrom(dateParts?.[0]),
		journal: type === "book" ? undefined : first(work["container-title"]),
		publisher: work.publisher,
		abstract: stripTags(work.abstract),
		isbn: work.ISBN?.[0]?.replace(/-/g, ""),
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
