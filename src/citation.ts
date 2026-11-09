/**
 * Pure module: a reference note's properties as a citation record (CSL-JSON, the format
 * Pandoc, Quarto and Zotero read), and checks that a record has what its type needs.
 * docs/citation-fields.md is the user-facing version of these tables.
 */
import { parseDate } from "./metadata/dates";
import { PersonName, namesFromProperty } from "./names";
import { PropertyKey } from "./properties";
import { asText } from "./text";

export interface CslName {
	family?: string;
	given?: string;
	literal?: string;
	"non-dropping-particle"?: string;
	suffix?: string;
}

export interface CslDate {
	"date-parts": number[][];
}

export interface CslItem {
	id: string;
	type: string;
	title?: string;
	author?: CslName[];
	editor?: CslName[];
	translator?: CslName[];
	contributor?: CslName[];
	issued?: CslDate;
	accessed?: CslDate;
	"container-title"?: string;
	"collection-title"?: string;
	publisher?: string;
	"publisher-place"?: string;
	volume?: string;
	issue?: string;
	page?: string;
	edition?: string;
	ISBN?: string;
	ISSN?: string;
	DOI?: string;
	URL?: string;
	language?: string;
	abstract?: string;
}

/**
 * The plugin's types as CSL types. "article" covers journal papers and news or blog
 * stories; a journal signal (volume, issue, ISSN or DOI) makes it a journal article.
 */
export const CSL_TYPES: Record<string, string> = {
	book: "book",
	chapter: "chapter",
	article: "article-magazine",
	paper: "paper-conference",
	report: "report",
	thesis: "thesis",
	document: "document",
	reference: "entry-encyclopedia",
	webpage: "webpage",
	video: "motion_picture",
	audio: "song",
	software: "software",
	presentation: "speech",
	image: "graphic",
};

/** Fields each CSL type needs for a usable citation, beyond an id and a title. */
export const REQUIRED: Record<string, (keyof CslItem | "author|editor")[]> = {
	book: ["author|editor", "issued", "publisher"],
	chapter: ["author", "container-title", "issued", "publisher"],
	"article-journal": ["author", "container-title", "issued"],
	"article-magazine": ["container-title", "issued"],
	"paper-conference": ["author", "container-title", "issued"],
	thesis: ["author", "publisher", "issued"],
	report: ["author|editor", "issued"],
	webpage: ["URL"],
	software: ["URL"],
};

type Fm = Record<string, unknown>;

const text = (v: unknown): string | undefined => {
	if (v === undefined || v === null) return undefined;
	if (Array.isArray(v)) return text(v[0]);
	if (v instanceof Date) return isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10);
	// A link loses its brackets and alias: "[[Nature|the journal]]" is "Nature".
	const s = asText(v).replace(/^\[\[([^\]|]*)(?:\|[^\]]*)?\]\]$/, "$1").trim();
	return s || undefined;
};

function cslName(n: PersonName): CslName {
	if (n.literal) return { literal: n.literal };
	const out: CslName = {};
	if (n.family) out.family = n.family;
	if (n.given) out.given = n.given;
	if (n.particle) out["non-dropping-particle"] = n.particle;
	if (n.suffix) out.suffix = n.suffix;
	return out;
}

/** An ISO date (YYYY, YYYY-MM or YYYY-MM-DD) as CSL date parts. */
export function cslDate(iso: string | undefined): CslDate | undefined {
	const d = iso ? parseDate(iso) : undefined;
	if (!d) return undefined;
	return { "date-parts": [d.split("-").map(Number)] };
}

/**
 * A note's properties as a CSL item. `p` maps the plugin's fields to the vault's property
 * names. Values are read as written: links lose their brackets, names split by the rules
 * in names.ts. Returns undefined when the note has no citekey.
 */
export function noteToCsl(fm: Fm, p: Record<PropertyKey, string>): CslItem | undefined {
	const id = text(fm[p.citekey]);
	if (!id) return undefined;
	const get = (k: PropertyKey) => text(fm[p[k]]);
	const people = (k: PropertyKey) => {
		const list = namesFromProperty(fm[p[k]]).map(cslName);
		return list.length ? list : undefined;
	};
	const type = get("type") ?? "document";
	const journalSignal = !!(get("volume") || get("issue") || get("issn") || get("doi"));
	const item: CslItem = {
		id,
		type: type === "article" && journalSignal ? "article-journal" : CSL_TYPES[type] ?? "document",
		title: get("title"),
		author: people("authors"),
		editor: people("editors"),
		translator: people("translators"),
		contributor: people("contributors"),
		// The full date, or the year when that's all the note has.
		issued: cslDate(get("published") ?? get("year")),
		accessed: cslDate(get("accessed")),
		"container-title": get("journal"),
		"collection-title": get("series"),
		publisher: get("publisher"),
		"publisher-place": get("place"),
		volume: get("volume"),
		issue: get("issue"),
		page: get("pages"),
		edition: get("edition"),
		ISBN: get("isbn"),
		ISSN: get("issn"),
		DOI: get("doi"),
		URL: get("url"),
		language: get("language"),
		abstract: get("abstract"),
	};
	for (const k of Object.keys(item) as (keyof CslItem)[]) if (item[k] === undefined) delete item[k];
	return item;
}

/** The fields a record lacks for its type, e.g. ["issued", "publisher"]. */
export function missingFields(item: CslItem): string[] {
	const out: string[] = [];
	if (!item.title) out.push("title");
	for (const need of REQUIRED[item.type] ?? []) {
		if (need === "author|editor") {
			if (!item.author?.length && !item.editor?.length) out.push("author or editor");
		} else if (item[need] === undefined) out.push(need);
	}
	return out;
}
