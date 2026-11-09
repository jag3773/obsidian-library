/**
 * Pure module: plan an import of bibliographic records into reference notes (#17, #18).
 *
 * Every importer (Zotero's Better BibTeX JSON, CSL-JSON, BibTeX/BibLaTeX, RIS) turns its file
 * into ImportRecords; this module decides everything else (which note each record belongs
 * to, what to write, what to create, rename or report) without touching the vault, so it
 * doubles as the dry run. Rules come from migrating a real library of a few thousand items:
 *
 * - Existing notes (often from the Zotero Integration plugin) get properties added; their
 *   bodies are never changed. Broken frontmatter is repaired, not skipped.
 * - Notes match records by: filename = citekey, then the note's citekey property, then the
 *   Zotero item key in a zotero://select link, then a DOI or ISBN found only once, then an
 *   exact title found only once. So a repeat import updates the same notes.
 * - Citekeys drift. A note named by an old key can be renamed to the current one; if a note
 *   under the current key already exists, the two are duplicates to merge by hand, never
 *   renamed onto each other.
 * - Collections can be reading workflow ("To read") and become a status, or a catch-all
 *   to drop. Tags can become properties ("Own" → owned: true).
 * - For a whole Zotero library, group-library notes aren't in a personal export: they're
 *   reported, not guessed at, and notes whose item is gone are listed.
 */
import { disambiguate, generateCitekey } from "../citekey";
import { canonicalIsbn, normalizeDoi } from "../identifiers";
import { ReferenceData } from "../metadata/types";
import { Diagnostic, ImportRecord, str } from "./record";

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
	/** When a note already has a value: keep it (default) or take the file's. */
	zoteroWins: boolean;
	referencesFolder: string;
	/** A vault path for an attachment, if the file is in the vault. Gets the path or link as the file wrote it. */
	findAttachment: (path: string) => string | undefined;
	/** Parse YAML, throwing on invalid input (Obsidian's parseYaml). */
	parseYaml: (text: string) => unknown;
	/** Pattern for citekeys of new notes whose record has none. Default: the plugin's default pattern. */
	citekeyPattern?: string;
}

/** Where the records came from. */
export interface ImportSource {
	/** "Zotero", "CSL-JSON", "BibTeX", "RIS": used in the report. */
	name: string;
	/**
	 * True for a whole Zotero library export: notes linked to a group library are set aside,
	 * and notes whose Zotero item isn't in the export are listed. A file is often a subset
	 * of a library, so for other files both are off.
	 */
	library: boolean;
	/** Problems the parser found (malformed records, unsupported types). */
	diagnostics?: Diagnostic[];
}

export interface Extras {
	citekey: string;
	status?: string;
	collections: string[];
	tags: string[];
	/** Properties from tag rules, keyed by property name. */
	tagProperties: Record<string, unknown>;
	/** Vault paths of the record's attachments that are in the vault, PDFs first. */
	attachments: string[];
	added?: string;
	/** zotero://select link, when the record came from Zotero. */
	zotero?: string;
	/** Child notes as HTML or text (only written into notes the import creates). */
	notes: string[];
}

export type MatchedBy = "filename" | "citekey property" | "Zotero link" | "identifier" | "title";

export interface PlannedUpdate {
	note: VaultNote;
	record: ImportRecord;
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
	record: ImportRecord;
	data: ReferenceData;
	extras: Extras;
}

export interface ImportPlan {
	/** Where the records came from ("Zotero", "BibTeX"…). */
	source: string;
	updates: PlannedUpdate[];
	creates: PlannedCreate[];
	report: ImportReport;
}

export interface ImportReport {
	items: number;
	matched: Record<MatchedBy, number>;
	/** Records that look like duplicates of an existing note (same title); not created. */
	zoteroDuplicates: { citekey: string; title: string; note: string }[];
	/** Records with no note, not created (createMissing off, or the name is taken). */
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
	/** Child notes on records whose vault note already exists (bodies are never changed). */
	zoteroNotesNotCopied: number;
	unmappedFields: Record<string, number>;
	/** The records (by label) that had each unmapped field. */
	unmappedRecords: Record<string, string[]>;
	itemTypes: Record<string, string>;
	collections: string[];
	/** Malformed records and other problems the parser found, one line per record. */
	diagnostics: Diagnostic[];
}

const lower = (s: string) => s.trim().toLowerCase();
const titleKey = (s: string) => lower(s).replace(/\s+/g, " ");
const H1 = /^# (.+)$/m;
const ZOTERO_LINK = /zotero:\/\/select\/(library|groups\/\d+)\/items\/([A-Z0-9]{8})/;
const DEFAULT_PATTERN = "auth.lower + shorttitle(3, 3) + year";

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

/** The record's DOI and ISBN in the forms notes are compared by. */
function identifiers(data: Pick<ReferenceData, "doi" | "isbn">): string[] {
	const out: string[] = [];
	const doi = data.doi ? normalizeDoi(data.doi) : null;
	if (doi) out.push(`doi:${doi.toLowerCase()}`);
	const isbn = data.isbn ? canonicalIsbn(data.isbn) : null;
	if (isbn) out.push(`isbn:${isbn}`);
	return out;
}

export function emptyReport(): ImportReport {
	return {
		items: 0,
		matched: { filename: 0, "citekey property": 0, "Zotero link": 0, identifier: 0, title: 0 },
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
		unmappedRecords: {},
		itemTypes: {},
		collections: [],
		diagnostics: [],
	};
}

/** Plan the import of records into notes. Nothing is written; the plan is the dry run. */
export function planRecords(records: ImportRecord[], notes: VaultNote[], o: ImportOptions, source: ImportSource): ImportPlan {
	const p = (k: string) => o.properties[k] ?? k;
	const report = emptyReport();
	report.items = records.length;
	report.diagnostics = [...(source.diagnostics ?? [])];
	report.collections = [...new Set(records.flatMap((r) => r.collections))].sort();

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
	const zoteroLinks = (n: VaultNote) => [...`${str(readable.get(n)![p("zotero")]) ?? ""}\n${n.body}`.matchAll(new RegExp(ZOTERO_LINK.source, "g"))];
	// Group-library notes aren't in a personal export: set them aside before matching, so no
	// personal item can claim one by filename, citekey or title.
	const isGroupNote = (n: VaultNote) => {
		const links = zoteroLinks(n);
		return links.length > 0 && links.every((l) => l[1] !== "library");
	};
	const sortedNotes = [...readable.keys()].filter((n) => {
		if (!source.library || !isGroupNote(n)) return true;
		report.groupNotes.push(n.path);
		return false;
	});
	const byBasename = new Map<string, VaultNote>();
	const byCitekeyProp = new Map<string, VaultNote>();
	const byZoteroKey = new Map<string, VaultNote[]>();
	const byIdentifier = new Map<string, VaultNote[]>();
	const byTitle = new Map<string, VaultNote[]>();
	const add = <K>(map: Map<K, VaultNote[]>, k: K, n: VaultNote) => map.set(k, [...(map.get(k) ?? []), n]);
	for (const n of sortedNotes) {
		const fm = readable.get(n)!;
		byBasename.set(lower(n.basename), n);
		const ck = str(fm[p("citekey")]);
		if (ck && !byCitekeyProp.has(lower(ck))) byCitekeyProp.set(lower(ck), n);
		const link = zoteroLinks(n).find((l) => l[1] === "library");
		if (link) add(byZoteroKey, link[2], n);
		for (const id of identifiers({ doi: str(fm[p("doi")]), isbn: str(fm[p("isbn")]) })) add(byIdentifier, id, n);
		const title = str(fm[p("title")]) ?? n.body.match(H1)?.[1];
		if (title) add(byTitle, titleKey(title), n);
	}
	const titleCount = new Map<string, number>();
	const idCount = new Map<string, number>();
	for (const r of records) {
		if (r.data.title) titleCount.set(titleKey(r.data.title), (titleCount.get(titleKey(r.data.title)) ?? 0) + 1);
		for (const id of identifiers(r.data)) idCount.set(id, (idCount.get(id) ?? 0) + 1);
	}

	// Match: each record to at most one note, each note to at most one record, strongest signal first.
	const noteFor = new Map<ImportRecord, { note: VaultNote; by: MatchedBy }>();
	const taken = new Map<VaultNote, ImportRecord>();
	const claim = (r: ImportRecord, note: VaultNote | undefined, by: MatchedBy) => {
		if (!note || noteFor.has(r)) return;
		if (taken.has(note)) return;
		noteFor.set(r, { note, by });
		taken.set(note, r);
	};
	for (const r of records) if (r.citekey) claim(r, byBasename.get(lower(r.citekey)), "filename");
	for (const r of records) if (r.citekey) claim(r, byCitekeyProp.get(lower(r.citekey)), "citekey property");
	for (const r of records) {
		if (!r.zoteroKey) continue;
		const list = byZoteroKey.get(r.zoteroKey) ?? [];
		claim(r, list.find((n) => !taken.has(n)), "Zotero link");
	}
	// A DOI or ISBN only one record and one note carry, and only when the record's own citekey note doesn't exist.
	for (const r of records) {
		if (r.citekey && byBasename.has(lower(r.citekey))) continue;
		for (const id of identifiers(r.data)) {
			if (idCount.get(id) !== 1) continue;
			const list = byIdentifier.get(id) ?? [];
			if (list.length === 1 && !taken.has(list[0])) claim(r, list[0], "identifier");
		}
	}
	for (const r of records) {
		const t = r.data.title;
		if (!t || titleCount.get(titleKey(t)) !== 1) continue;
		const list = (byTitle.get(titleKey(t)) ?? []).filter((n) => !taken.has(n));
		// Only a title found once, and only when the record's own citekey note doesn't exist.
		if (list.length === 1 && !(r.citekey && byBasename.has(lower(r.citekey)))) claim(r, list[0], "title");
	}

	// Notes left over: duplicates of a matched note, group items, or deleted from Zotero.
	const byKey = new Map(records.filter((r) => r.zoteroKey).map((r) => [r.zoteroKey!, r]));
	for (const n of sortedNotes) {
		if (taken.has(n)) continue;
		const link = zoteroLinks(n).find((l) => l[1] === "library");
		if (!link) continue;
		const r = byKey.get(link[2]);
		const kept = r && noteFor.get(r);
		if (kept) report.duplicateNotes.push({ note: n.path, keptNote: kept.note.path, citekey: r.citekey ?? r.label });
		else if (source.library) report.missingFromExport.push(n.path);
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

	const extrasFor = (r: ImportRecord, body: string | undefined, notePath: string | undefined, citekey: string): Extras => {
		const tagProps: Record<string, unknown> = {};
		const tags: string[] = [];
		const tagStatuses: { status: string; index: number }[] = [];
		const statusCandidates: string[] = [];
		for (const t of r.tags) {
			if (!o.automaticTags && t.automatic) continue;
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
		for (const name of r.collections) {
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
		for (const path of r.attachments) {
			if (!path.trim()) continue;
			const found = o.findAttachment(path);
			if (found) {
				if (!attachments.includes(found)) attachments.push(found);
			} else if (/[\\/]storage[\\/][A-Z0-9]{8}[\\/][^\\/]+\.html?$/i.test(path)) report.snapshotsLeftInZotero++;
			else report.attachmentsNotInVault.push({ citekey, path });
		}
		attachments.sort((a, b) => Number(!/\.pdf$/i.test(a)) - Number(!/\.pdf$/i.test(b)));
		return {
			citekey,
			status,
			collections,
			tags,
			tagProperties: tagProps,
			attachments,
			added: r.added,
			zotero: r.zoteroKey ? `zotero://select/library/items/${r.zoteroKey}` : undefined,
			notes: r.notes.filter((t) => t.trim()),
		};
	};

	const plan: ImportPlan = { source: source.name, updates: [], creates: [], report };
	const folder = o.referencesFolder.replace(/\/+$/, "");
	// Every note, group ones included: a rename or a new note must not take any of their names.
	const existingNames = new Set([...readable.keys()].map((n) => lower(n.basename)));
	const existingKeys = new Set([...readable.values()].map((fm) => str(fm[p("citekey")])).filter((k): k is string => !!k).map(lower));
	for (const r of records) {
		report.itemTypes[r.sourceType] = r.data.type;
		for (const f of r.unmapped) {
			report.unmappedFields[f] = (report.unmappedFields[f] ?? 0) + 1;
			(report.unmappedRecords[f] ??= []).push(r.label);
		}
		const data = r.data;
		const match = noteFor.get(r);
		if (match) {
			const { note, by } = match;
			report.matched[by]++;
			const current = r.citekey ?? note.basename;
			let citekey = note.basename;
			let renameTo: string | undefined;
			if (r.citekey && lower(note.basename) !== lower(r.citekey)) {
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
			} else citekey = r.citekey ?? note.basename;
			const extras = extrasFor(r, note.body, note.path, citekey);
			if (repaired.has(note)) report.repairedNotes.push(note.path);
			report.zoteroNotesNotCopied += extras.notes.length;
			plan.updates.push({ note, record: r, data, extras, matchedBy: by, repaired: repaired.get(note), renameTo });
			continue;
		}
		const citekey =
			r.citekey ??
			r.zoteroKey ??
			disambiguate(generateCitekey({ title: data.title, authors: data.familyNames, year: data.year }, o.citekeyPattern || DEFAULT_PATTERN) || "ref", (k) =>
				existingNames.has(lower(k)) || existingKeys.has(lower(k))
			);
		const sameTitle = data.title ? (byTitle.get(titleKey(data.title)) ?? [])[0] : undefined;
		if (sameTitle) {
			report.zoteroDuplicates.push({ citekey, title: data.title, note: sameTitle.path });
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
		existingKeys.add(lower(citekey));
		plan.creates.push({ path: `${folder ? folder + "/" : ""}${safe}.md`, record: r, data, extras: extrasFor(r, undefined, undefined, citekey) });
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
