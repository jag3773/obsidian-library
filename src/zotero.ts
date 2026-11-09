/**
 * Pure module: a Better BibTeX JSON export (#18) as import records. Matching, the dry run and
 * every rule about notes live in importers/plan.ts, shared with the other file formats (#17).
 */
import { canonicalIsbn, normalizeDoi } from "./identifiers";
import { parseDate, yearOf } from "./metadata/dates";
import { ReferenceData } from "./metadata/types";
import { PersonName, displayName, familyOf } from "./names";
import { asText } from "./text";
import { ImportOptions, ImportPlan, VaultNote, planRecords } from "./importers/plan";
import { ImportRecord, str } from "./importers/record";

export * from "./importers/plan";

export interface BbtCreator {
	creatorType?: string;
	firstName?: string;
	lastName?: string;
	name?: string;
}

export interface BbtAttachment {
	title?: string;
	path?: string;
	url?: string;
}

export interface BbtItem {
	key: string;
	itemID?: number;
	itemType: string;
	citationKey?: string;
	title?: string;
	creators?: BbtCreator[];
	tags?: { tag: string; type?: number }[];
	attachments?: BbtAttachment[];
	notes?: { note?: string }[];
	[field: string]: unknown;
}

export interface BbtExport {
	items: BbtItem[];
	collections?: Record<string, { key?: string; name: string; parent?: string | false; items?: number[] }>;
}

/** Zotero item types as the plugin's types. */
export const ZOTERO_TYPES: Record<string, string> = {
	book: "book",
	bookSection: "chapter",
	journalArticle: "article",
	magazineArticle: "article",
	newspaperArticle: "article",
	blogPost: "article",
	webpage: "webpage",
	forumPost: "webpage",
	videoRecording: "video",
	film: "video",
	tvBroadcast: "video",
	audioRecording: "audio",
	podcast: "audio",
	radioBroadcast: "audio",
	document: "document",
	manuscript: "document",
	letter: "document",
	email: "document",
	interview: "document",
	report: "report",
	thesis: "thesis",
	presentation: "presentation",
	conferencePaper: "paper",
	preprint: "paper",
	computerProgram: "software",
	artwork: "image",
	map: "image",
	encyclopediaArticle: "reference",
	dictionaryEntry: "reference",
};

/** Creator roles that are an item's primary creators (its "authors"). */
const PRIMARY = new Set(["author", "director", "presenter", "programmer", "podcaster", "artist", "performer", "creator", "interviewee", "sponsor", "inventor", "cartographer"]);

/** Zotero fields the plugin maps, and the ones that are bookkeeping rather than metadata. */
const CONTAINER_FIELDS = ["publicationTitle", "bookTitle", "proceedingsTitle", "websiteTitle", "blogTitle", "forumTitle", "encyclopediaTitle", "dictionaryTitle", "programTitle"];
const PUBLISHER_FIELDS = ["publisher", "institution", "university", "company", "label", "studio", "distributor", "network", "repository"];
const MAPPED = new Set([
	"title", "date", "dateAdded", "url", "accessDate", "abstractNote", "place", "volume", "issue", "pages", "edition", "series",
	"language", "ISBN", "ISSN", "DOI", ...CONTAINER_FIELDS, ...PUBLISHER_FIELDS,
]);
const BOOKKEEPING = new Set([
	"key", "version", "itemType", "citationKey", "creators", "tags", "relations", "dateModified", "uri", "itemID", "attachments",
	"notes", "autoJournalAbbreviation", "itemKey", "libraryID", "select", "collections", "citekey",
]);

const PARTICLE = /^((?:(?:van|von|de|der|den|del|della|di|da|du|dos|la|le|ten|ter|zu)\s+)+)(.+)$/;

/** A Zotero creator as a name: single-field names stay whole, leading particles split off. */
export function zoteroName(c: BbtCreator): PersonName | undefined {
	const single = c.name?.trim();
	if (single) return { literal: single };
	const last = c.lastName?.trim() ?? "";
	const first = c.firstName?.trim() ?? "";
	if (!last) return first ? { literal: first } : undefined;
	if (!first) return { literal: last };
	const m = last.match(PARTICLE);
	return m ? { given: first, particle: m[1].trim(), family: m[2] } : { given: first, family: last };
}

/** The item as the plugin's metadata. */
export function itemToReference(item: BbtItem): ReferenceData {
	const roles: Record<"authors" | "editors" | "translators" | "contributors", PersonName[]> = { authors: [], editors: [], translators: [], contributors: [] };
	for (const c of item.creators ?? []) {
		const n = zoteroName(c);
		if (!n) continue;
		const role = c.creatorType ?? "author";
		const list = PRIMARY.has(role) ? roles.authors : role === "editor" ? roles.editors : role === "translator" ? roles.translators : roles.contributors;
		list.push(n);
	}
	const date = parseDate(str(item.date));
	const doi = str(item.DOI) ?? asText(item.extra).match(/^DOI:\s*(\S+)/im)?.[1];
	const isbn = str(item.ISBN)
		?.split(/[\s,;]+/)
		.map((s) => canonicalIsbn(s))
		.find(Boolean);
	const list = (k: keyof typeof roles) => (roles[k].length ? roles[k].map(displayName) : undefined);
	return {
		type: ZOTERO_TYPES[item.itemType] ?? "document",
		// No title in Zotero proposes none, so a note's own title is never replaced by a key.
		title: str(item.title) ?? "",
		authors: roles.authors.map(displayName),
		familyNames: (roles.authors.length ? roles.authors : roles.editors).map(familyOf),
		editors: list("editors"),
		translators: list("translators"),
		contributors: list("contributors"),
		names: roles,
		date,
		year: yearOf(date),
		publisher: PUBLISHER_FIELDS.map((k) => str(item[k])).find(Boolean),
		place: str(item.place),
		journal: CONTAINER_FIELDS.map((k) => str(item[k])).find(Boolean),
		volume: str(item.volume),
		issue: str(item.issue),
		pages: str(item.pages),
		edition: str(item.edition),
		series: str(item.series),
		language: str(item.language),
		isbn: isbn ?? undefined,
		issn: str(item.ISSN),
		doi: doi ? normalizeDoi(doi) ?? undefined : undefined,
		url: str(item.url),
		accessed: parseDate(str(item.accessDate)),
		abstract: str(item.abstractNote),
		source: "Zotero",
	};
}

/** Zotero fields with a value that the import doesn't keep, e.g. callNumber, extra. */
export function unmappedFields(item: BbtItem): string[] {
	return Object.keys(item).filter((k) => !MAPPED.has(k) && !BOOKKEEPING.has(k) && str(item[k]) !== undefined);
}

/** A Zotero item as an import record; collections by name come from the export. */
export function itemToRecord(item: BbtItem, collections: string[] = []): ImportRecord {
	return {
		label: item.citationKey ?? item.key,
		citekey: item.citationKey || undefined,
		zoteroKey: item.key,
		sourceType: item.itemType,
		data: itemToReference(item),
		tags: (item.tags ?? []).map((t) => ({ tag: t.tag, automatic: t.type === 1 })),
		collections,
		attachments: (item.attachments ?? []).map((a) => a.path ?? "").filter(Boolean),
		added: parseDate(str(item.dateAdded)),
		notes: (item.notes ?? []).map((nt) => String(nt.note ?? "")),
		unmapped: unmappedFields(item),
	};
}

/** The export's items (not attachments, notes or annotations) as import records. */
export function exportRecords(exp: BbtExport): ImportRecord[] {
	const collectionsOf = new Map<number, string[]>();
	for (const c of Object.values(exp.collections ?? {})) for (const id of c.items ?? []) collectionsOf.set(id, [...(collectionsOf.get(id) ?? []), c.name]);
	return exp.items
		.filter((i) => i.itemType !== "attachment" && i.itemType !== "note" && i.itemType !== "annotation")
		.map((i) => itemToRecord(i, collectionsOf.get(i.itemID ?? -1) ?? []));
}

/** Plan the import of a Better BibTeX JSON export. Nothing is written; the plan is the dry run. */
export function planImport(exp: BbtExport, notes: VaultNote[], o: ImportOptions): ImportPlan {
	const plan = planRecords(exportRecords(exp), notes, o, { name: "Zotero", library: true });
	// Every collection in the export, including empty ones, so each can be given a rule.
	plan.report.collections = [...new Set([...plan.report.collections, ...Object.values(exp.collections ?? {}).map((c) => c.name)])].sort();
	return plan;
}
