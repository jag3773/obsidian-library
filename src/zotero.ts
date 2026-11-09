/**
 * Pure module: plan an import of a Better BibTeX JSON export (#18).
 *
 * The plan decides everything (which note each Zotero item belongs to, what to write, what
 * to create, rename or report) without touching the vault, so it doubles as the dry run.
 * Rules come from migrating a real library of a few thousand items:
 *
 * - Existing notes (often from the Zotero Integration plugin) get properties added; their
 *   bodies are never changed. Broken frontmatter is repaired, not skipped.
 * - Notes match items by: filename = citekey, then the note's citekey property, then the
 *   Zotero item key in a zotero://select link, then an exact title found only once.
 * - Better BibTeX citekeys drift. A note named by an old key can be renamed to the current
 *   one; if a note under the current key already exists, the two are duplicates to merge
 *   by hand, never renamed onto each other.
 * - Collections can be reading workflow ("To read") and become a status, or a catch-all
 *   to drop. Tags can become properties ("Own" → owned: true).
 * - Group-library notes aren't in a personal export: they're reported, not guessed at.
 */
import { canonicalIsbn, normalizeDoi } from "./identifiers";
import { parseDate, yearOf } from "./metadata/dates";
import { ReferenceData } from "./metadata/types";
import { PersonName, displayName, familyOf } from "./names";

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

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);

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
	const doi = str(item.DOI) ?? String(item.extra ?? "").match(/^DOI:\s*(\S+)/im)?.[1];
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

// Vault side -------------------------------------------------------------------------------

export interface VaultNote {
	path: string;
	basename: string;
	/** Parsed frontmatter, or null when the note has frontmatter Obsidian can't read. */
	frontmatter: Record<string, unknown> | null;
	/** The raw frontmatter text between the --- lines, if any. */
	rawFrontmatter?: string;
	body: string;
}

export type CollectionRule = { kind: "collection" } | { kind: "status"; status: string } | { kind: "drop" };

export interface ImportOptions {
	/** The plugin's field → property names. */
	properties: Record<string, string>;
	/** Rule per collection name; collections without one are kept as collections. */
	collections: Record<string, CollectionRule>;
	/**
	 * Tag (case-insensitive) → a property and value, e.g. "own" → owned: true. A rule ending
	 * in * matches tags starting with the rest ("reviewed-in-*"). A rule setting the status
	 * property is a status rule; when several apply, the one listed first wins.
	 */
	tags: Record<string, { property: string; value: unknown }>;
	/** Statuses in reading order: when several apply, the latest wins (the fallback ranks lowest). */
	statuses: string[];
	/** Status for items no rule gives one. Empty: leave unset. */
	fallbackStatus: string;
	/**
	 * Status for notes that already have annotations: it beats collection rules ("To read"
	 * but already highlighted means read), but not a tag's status rule. Empty: off.
	 */
	annotatedStatus: string;
	/** Keep automatic tags (from catalogs and feeds), not only the ones you added. */
	automaticTags: boolean;
	/** Create notes for items that have none. */
	createMissing: boolean;
	/** Rename notes whose filename is an old citekey to the current one. */
	renameToCurrentKeys: boolean;
	/** When a note already has a value: keep it (default) or take Zotero's. */
	zoteroWins: boolean;
	referencesFolder: string;
	/** A vault path for an attachment's filename, if the file is in the vault. */
	findAttachment: (filename: string) => string | undefined;
	/** Parse YAML, throwing on invalid input (Obsidian's parseYaml). */
	parseYaml: (text: string) => unknown;
}

export interface Extras {
	citekey: string;
	status?: string;
	collections: string[];
	tags: string[];
	/** Properties from tag rules, keyed by property name. */
	tagProperties: Record<string, unknown>;
	/** Vault paths of the item's attachments that are in the vault, PDFs first. */
	attachments: string[];
	added?: string;
	zotero: string;
	/** Zotero child notes as plain text (only written into notes the import creates). */
	notes: string[];
}

export type MatchedBy = "filename" | "citekey property" | "Zotero link" | "title";

export interface PlannedUpdate {
	note: VaultNote;
	item: BbtItem;
	data: ReferenceData;
	extras: Extras;
	matchedBy: MatchedBy;
	/** Repaired frontmatter to write first, when the note's couldn't be read. */
	repaired?: Record<string, unknown>;
	/** New path, when renaming to the current citekey. */
	renameTo?: string;
}

export interface PlannedCreate {
	path: string;
	item: BbtItem;
	data: ReferenceData;
	extras: Extras;
}

export interface ImportPlan {
	updates: PlannedUpdate[];
	creates: PlannedCreate[];
	report: ImportReport;
}

export interface ImportReport {
	items: number;
	matched: Record<MatchedBy, number>;
	/** Items in Zotero that look like duplicates of an existing note (same title); not created. */
	zoteroDuplicates: { citekey: string; title: string; note: string }[];
	/** Items with no note, not created (createMissing off). */
	notCreated: string[];
	/** Notes from a group library, which a personal export doesn't contain. */
	groupNotes: string[];
	/** Notes that link to a Zotero item the export doesn't have (deleted from Zotero?). */
	missingFromExport: string[];
	/** Two notes for one item: the second is a duplicate to merge by hand. */
	duplicateNotes: { note: string; keptNote: string; citekey: string }[];
	/** Notes whose filename differs from the item's current citekey. */
	keyChanges: { note: string; citekey: string; renamed: boolean; reason?: string }[];
	repairedNotes: string[];
	/** Status decided against a collection rule (e.g. "To read" but already annotated). */
	statusConflicts: { note: string; detail: string }[];
	attachmentsNotInVault: { citekey: string; path: string }[];
	/** Web page snapshots in Zotero's own storage; Zotero keeps them, the vault doesn't need them. */
	snapshotsLeftInZotero: number;
	/** Zotero child notes on items whose vault note already exists (bodies are never changed). */
	zoteroNotesNotCopied: number;
	unmappedFields: Record<string, number>;
	itemTypes: Record<string, string>;
	collections: string[];
}

const lower = (s: string) => s.trim().toLowerCase();
const titleKey = (s: string) => lower(s).replace(/\s+/g, " ");
const H1 = /^# (.+)$/m;
const ZOTERO_LINK = /zotero:\/\/select\/(library|groups\/\d+)\/items\/([A-Z0-9]{8})/;

/**
 * True when the note's "## Annotations" section holds highlights: quoted passages, callouts
 * or embedded images, as Zotero Integration writes them. Plain text there (a copied Zotero
 * note such as "Comment: 11 pages") doesn't count.
 */
export function hasAnnotations(body: string): boolean {
	const section = body.split(/^## Annotations\s*$/m)[1];
	if (!section) return false;
	return section
		.split(/^## /m)[0]
		.split("\n")
		.some((l) => /^\s*>\s*\S|!\[\[/.test(l));
}

/** Characters that can't appear in a filename on some platform. */
const BAD_FILENAME = /[\\/:*?"<>|#^[\]]/;

/** Obsidian tag text: no spaces or tag-breaking punctuation. */
export function tagText(t: string): string {
	return t.trim().replace(/^#/, "").replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_\-/]/gu, "");
}

/**
 * Repair frontmatter Obsidian can't parse, keeping every line that parses on its own and
 * rebuilding aliases from the note's heading. Zotero Integration's aliases with unescaped
 * quotes are the common case.
 */
export function repairFrontmatter(raw: string, body: string, parse: (t: string) => unknown): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const lines = raw.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/^([^\s:#][^:]*):(.*)$/);
		if (!m) continue;
		// A key with an indented block (a list) under it.
		let block = lines[i];
		while (i + 1 < lines.length && /^(\s+|-\s)/.test(lines[i + 1])) block += "\n" + lines[++i];
		try {
			const parsed = parse(block);
			if (parsed && typeof parsed === "object") Object.assign(out, parsed);
		} catch {
			/* drop the line that broke the file */
		}
	}
	const h1 = body.match(H1)?.[1]?.trim();
	if (h1 && !Array.isArray(out.aliases)) out.aliases = [h1];
	return out;
}

/** Plan the import. Nothing is written; the plan is the dry run. */
export function planImport(exp: BbtExport, notes: VaultNote[], o: ImportOptions): ImportPlan {
	const p = (k: string) => o.properties[k] ?? k;
	const report: ImportReport = {
		items: 0,
		matched: { filename: 0, "citekey property": 0, "Zotero link": 0, title: 0 },
		zoteroDuplicates: [],
		notCreated: [],
		groupNotes: [],
		missingFromExport: [],
		duplicateNotes: [],
		keyChanges: [],
		repairedNotes: [],
		statusConflicts: [],
		attachmentsNotInVault: [],
		snapshotsLeftInZotero: 0,
		zoteroNotesNotCopied: 0,
		unmappedFields: {},
		itemTypes: {},
		collections: [],
	};
	const items = exp.items.filter((i) => i.itemType !== "attachment" && i.itemType !== "note" && i.itemType !== "annotation");
	report.items = items.length;

	// Collections by item ID.
	const collectionsOf = new Map<number, string[]>();
	for (const c of Object.values(exp.collections ?? {})) {
		report.collections.push(c.name);
		for (const id of c.items ?? []) collectionsOf.set(id, [...(collectionsOf.get(id) ?? []), c.name]);
	}
	report.collections.sort();

	// Notes: parsed frontmatter (repaired when broken) and the signals used to match them.
	const readable = new Map<VaultNote, Record<string, unknown>>();
	const repaired = new Map<VaultNote, Record<string, unknown>>();
	for (const n of [...notes].sort((a, b) => (a.path < b.path ? -1 : 1))) {
		if (n.frontmatter) readable.set(n, n.frontmatter);
		else if (n.rawFrontmatter !== undefined) {
			const fixed = repairFrontmatter(n.rawFrontmatter, n.body, o.parseYaml);
			repaired.set(n, fixed);
			readable.set(n, fixed);
		} else readable.set(n, {});
	}
	// Group-library notes aren't in a personal export: set them aside before matching, so no
	// personal item can claim one by filename, citekey or title.
	const isGroupNote = (n: VaultNote) => {
		const text = `${str(readable.get(n)![p("zotero")]) ?? ""}\n${n.body}`;
		const links = [...text.matchAll(new RegExp(ZOTERO_LINK.source, "g"))];
		return links.length > 0 && links.every((l) => l[1] !== "library");
	};
	const sortedNotes = [...readable.keys()].filter((n) => {
		if (!isGroupNote(n)) return true;
		report.groupNotes.push(n.path);
		return false;
	});
	const byBasename = new Map<string, VaultNote>();
	const byCitekeyProp = new Map<string, VaultNote>();
	const byZoteroKey = new Map<string, VaultNote[]>();
	const byTitle = new Map<string, VaultNote[]>();
	for (const n of sortedNotes) {
		const fm = readable.get(n)!;
		byBasename.set(lower(n.basename), n);
		const ck = str(fm[p("citekey")]);
		if (ck && !byCitekeyProp.has(lower(ck))) byCitekeyProp.set(lower(ck), n);
		const link = [...`${str(fm[p("zotero")]) ?? ""}\n${n.body}`.matchAll(new RegExp(ZOTERO_LINK.source, "g"))].find((l) => l[1] === "library");
		if (link) byZoteroKey.set(link[2], [...(byZoteroKey.get(link[2]) ?? []), n]);
		const title = str(fm[p("title")]) ?? n.body.match(H1)?.[1];
		if (title) byTitle.set(titleKey(title), [...(byTitle.get(titleKey(title)) ?? []), n]);
	}
	const titleCount = new Map<string, number>();
	for (const i of items) if (i.title) titleCount.set(titleKey(i.title), (titleCount.get(titleKey(i.title)) ?? 0) + 1);

	// Match: each item to at most one note, each note to at most one item, strongest signal first.
	const noteFor = new Map<BbtItem, { note: VaultNote; by: MatchedBy }>();
	const taken = new Map<VaultNote, BbtItem>();
	const claim = (item: BbtItem, note: VaultNote | undefined, by: MatchedBy) => {
		if (!note || noteFor.has(item)) return;
		if (taken.has(note)) return;
		noteFor.set(item, { note, by });
		taken.set(note, item);
	};
	for (const i of items) if (i.citationKey) claim(i, byBasename.get(lower(i.citationKey)), "filename");
	for (const i of items) if (i.citationKey) claim(i, byCitekeyProp.get(lower(i.citationKey)), "citekey property");
	for (const i of items) {
		const list = byZoteroKey.get(i.key) ?? [];
		claim(i, list.find((n) => !taken.has(n)), "Zotero link");
	}
	for (const i of items) {
		if (!i.title || titleCount.get(titleKey(i.title)) !== 1) continue;
		const list = (byTitle.get(titleKey(i.title)) ?? []).filter((n) => !taken.has(n));
		// Only a title found once, and only when the item's own citekey note doesn't exist.
		if (list.length === 1 && !(i.citationKey && byBasename.has(lower(i.citationKey)))) claim(i, list[0], "title");
	}

	// Notes left over: duplicates of a matched note, group items, or deleted from Zotero.
	const byKey = new Map(items.map((i) => [i.key, i]));
	for (const n of sortedNotes) {
		if (taken.has(n)) continue;
		const fm = readable.get(n)!;
		const text = `${str(fm[p("zotero")]) ?? ""}\n${n.body}`;
		const link = [...text.matchAll(new RegExp(ZOTERO_LINK.source, "g"))].find((l) => l[1] === "library");
		if (!link) continue;
		const item = byKey.get(link[2]);
		const kept = item && noteFor.get(item);
		if (kept) report.duplicateNotes.push({ note: n.path, keptNote: kept.note.path, citekey: item!.citationKey ?? item!.key });
		else report.missingFromExport.push(n.path);
	}

	const tagRules = Object.entries(o.tags).map(([k, rule]) => ({ key: lower(k), rule }));
	// Tags are compared as written and as stored ("Reviewed in 2025" is #Reviewed-in-2025).
	// Returns the rule and its position: when several tags set the status, the earliest rule wins.
	const tagRule = (tag: string) => {
		for (const t of [lower(tag), lower(tagText(tag))]) {
			const index = tagRules.findIndex(({ key }) => (key.endsWith("*") ? t.startsWith(key.slice(0, -1)) : t === key));
			if (index >= 0) return { ...tagRules[index].rule, index };
		}
		return undefined;
	};

	const extrasFor = (item: BbtItem, data: ReferenceData, body: string | undefined, notePath: string | undefined, citekey: string): Extras => {
		const tagProps: Record<string, unknown> = {};
		const tags: string[] = [];
		const tagStatuses: { status: string; index: number }[] = [];
		const statusCandidates: string[] = [];
		for (const t of item.tags ?? []) {
			if (!o.automaticTags && t.type === 1) continue;
			const rule = tagRule(t.tag);
			if (rule) {
				if (rule.property === p("status")) tagStatuses.push({ status: String(rule.value), index: rule.index });
				else tagProps[rule.property] = rule.value;
				continue;
			}
			const text = tagText(t.tag);
			if (text && !tags.includes(text)) tags.push(text);
		}
		const collections: string[] = [];
		for (const name of collectionsOf.get(item.itemID ?? -1) ?? []) {
			const rule = o.collections[name] ?? { kind: "collection" };
			if (rule.kind === "status") statusCandidates.push(rule.status);
			else if (rule.kind === "collection" && !collections.includes(name)) collections.push(name);
		}
		// Precedence: a tag's status (earliest rule wins), then "already annotated", then
		// collections (latest in reading order wins), then the fallback.
		const rank = (s: string) => (s === o.fallbackStatus ? -1 : o.statuses.indexOf(s));
		const best = (list: string[]) => [...list].sort((a, b) => rank(b) - rank(a))[0] as string | undefined;
		let status: string | undefined = [...tagStatuses].sort((a, b) => a.index - b.index)[0]?.status;
		if (!status && o.annotatedStatus && body && hasAnnotations(body)) {
			const fromCollections = best(statusCandidates);
			if (fromCollections && fromCollections !== o.annotatedStatus)
				report.statusConflicts.push({ note: notePath ?? citekey, detail: `${fromCollections} by collection, but already annotated; set ${o.annotatedStatus}` });
			status = o.annotatedStatus;
		}
		status ??= best(statusCandidates);
		status ??= o.fallbackStatus || undefined;
		const attachments: string[] = [];
		for (const a of item.attachments ?? []) {
			if (!a.path) continue;
			const name = a.path.split(/[\\/]/).pop()!;
			const found = o.findAttachment(name);
			if (found) {
				if (!attachments.includes(found)) attachments.push(found);
			} else if (/[\\/]storage[\\/][A-Z0-9]{8}[\\/][^\\/]+\.html?$/i.test(a.path)) report.snapshotsLeftInZotero++;
			else report.attachmentsNotInVault.push({ citekey, path: a.path });
		}
		attachments.sort((a, b) => Number(!/\.pdf$/i.test(a)) - Number(!/\.pdf$/i.test(b)));
		const added = parseDate(str(item.dateAdded));
		return {
			citekey,
			status,
			collections,
			tags,
			tagProperties: tagProps,
			attachments,
			added,
			zotero: `zotero://select/library/items/${item.key}`,
			notes: (item.notes ?? []).map((nt) => String(nt.note ?? "")).filter((t) => t.trim()),
		};
	};

	const plan: ImportPlan = { updates: [], creates: [], report };
	const folder = o.referencesFolder.replace(/\/+$/, "");
	// Every note, group ones included: a rename or a new note must not take any of their names.
	const existingNames = new Set([...readable.keys()].map((n) => lower(n.basename)));
	for (const item of items) {
		report.itemTypes[item.itemType] = ZOTERO_TYPES[item.itemType] ?? "document";
		for (const f of unmappedFields(item)) report.unmappedFields[f] = (report.unmappedFields[f] ?? 0) + 1;
		const data = itemToReference(item);
		const match = noteFor.get(item);
		if (match) {
			const { note, by } = match;
			report.matched[by]++;
			const current = item.citationKey ?? note.basename;
			let citekey = note.basename;
			let renameTo: string | undefined;
			if (item.citationKey && lower(note.basename) !== lower(item.citationKey)) {
				if (!o.renameToCurrentKeys) report.keyChanges.push({ note: note.path, citekey: current, renamed: false });
				else if (BAD_FILENAME.test(current)) report.keyChanges.push({ note: note.path, citekey: current, renamed: false, reason: "has characters a filename can't" });
				else if (existingNames.has(lower(current))) report.keyChanges.push({ note: note.path, citekey: current, renamed: false, reason: "a note with that name exists" });
				else {
					const dir = note.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/") + 1) : "";
					renameTo = `${dir}${current}.md`;
					citekey = current;
					existingNames.add(lower(current));
					report.keyChanges.push({ note: note.path, citekey: current, renamed: true });
				}
			} else citekey = item.citationKey ?? note.basename;
			const extras = extrasFor(item, data, note.body, note.path, citekey);
			if (repaired.has(note)) report.repairedNotes.push(note.path);
			report.zoteroNotesNotCopied += extras.notes.length;
			plan.updates.push({ note, item, data, extras, matchedBy: by, repaired: repaired.get(note), renameTo });
			continue;
		}
		const citekey = item.citationKey ?? item.key;
		const sameTitle = item.title ? (byTitle.get(titleKey(item.title)) ?? [])[0] : undefined;
		if (sameTitle) {
			report.zoteroDuplicates.push({ citekey, title: item.title!, note: sameTitle.path });
			continue;
		}
		if (!o.createMissing) {
			report.notCreated.push(citekey);
			continue;
		}
		const safe = BAD_FILENAME.test(citekey) ? citekey.replace(new RegExp(BAD_FILENAME.source, "g"), "_") : citekey;
		if (existingNames.has(lower(safe))) {
			report.notCreated.push(citekey);
			continue;
		}
		existingNames.add(lower(safe));
		plan.creates.push({ path: `${folder ? folder + "/" : ""}${safe}.md`, item, data, extras: extrasFor(item, data, undefined, undefined, citekey) });
	}
	plan.updates.sort((a, b) => (a.note.path < b.note.path ? -1 : 1));
	plan.creates.sort((a, b) => (a.path < b.path ? -1 : 1));
	return plan;
}

/** What the user chose in the import dialog; kept in settings so a re-run starts from it. */
export interface ImportChoices {
	exportPath: string;
	collections: Record<string, CollectionRule>;
	/** One rule per line: "Own = owned: true", "Reviewed-in-* = status: processed". */
	tagRules: string;
	fallbackStatus: string;
	annotatedStatus: string;
	automaticTags: boolean;
	createMissing: boolean;
	renameToCurrentKeys: boolean;
	zoteroWins: boolean;
}

export const DEFAULT_IMPORT_CHOICES: ImportChoices = {
	exportPath: "",
	collections: {},
	tagRules: "",
	fallbackStatus: "",
	annotatedStatus: "",
	automaticTags: true,
	createMissing: true,
	renameToCurrentKeys: false,
	zoteroWins: false,
};

/** Parse tag rules: "Own = owned: true" lines into rules. Values true/false/numbers are typed. */
export function parseTagRules(text: string): { rules: ImportOptions["tags"]; errors: string[] } {
	const rules: ImportOptions["tags"] = {};
	const errors: string[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const m = line.match(/^(.+?)\s*=\s*([^:]+):\s*(.*)$/);
		if (!m) {
			errors.push(`"${line}" isn't "tag = property: value"`);
			continue;
		}
		const v = m[3].trim();
		const value = v === "true" ? true : v === "false" ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
		rules[m[1].trim().toLowerCase()] = { property: m[2].trim(), value };
	}
	return { rules, errors };
}
