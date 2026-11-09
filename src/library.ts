import { App, TFile, TFolder, getFrontMatterInfo, normalizePath, parseYaml } from "obsidian";
import { disambiguate, generateCitekey } from "./citekey";
import { Identifier, canonicalIsbn, normalizeDoi, normalizeIsbn } from "./identifiers";
import { ReferenceData } from "./metadata/types";
import { familyOf, nameValue, namesFromProperty, parseName } from "./names";
import { FieldChange, compareProperties } from "./manual";
import { sameBytes } from "./sync";
import { FIELD_LABELS, PEOPLE_KEYS, PeopleKey, TEXT_KEYS } from "./properties";
import { LibrarySettings, PropertyKey } from "./settings";
import { DEFAULT_TEMPLATE, escapeMarkdown, markdownSafeUrl, renderTemplate, safeFilename } from "./template";
import { asText, localDate } from "./text";

type Frontmatter = Record<string, unknown>;

const isEmpty = (v: unknown) =>
	v === undefined || v === null || v === "" || (Array.isArray(v) && v.filter((x) => x !== null && x !== "").length === 0);

/** Strip [[ ]] and aliases from a link-ish property value. */
export function unlink(v: unknown): string {
	return asText(v)
		.replace(/^\[\[/, "")
		.replace(/\]\]$/, "")
		.split("|")[0]
		.trim();
}

/** Thrown when the plugin was unloaded while work was queued or in flight. */
export class Cancelled extends Error {
	constructor() {
		super("Library was unloaded");
		this.name = "Cancelled";
	}
}

/**
 * Identity used for duplicate detection: lower-case DOI, ISBN-13, and URLs without a
 * trailing slash. A reference can carry several URLs: the canonical one and the URL it
 * was captured from (e.g. a clip's "source").
 */
interface Identity {
	doi?: string;
	isbn?: string;
	urls: string[];
}

const urlKey = (v: unknown) => (typeof v === "string" && /^https?:\/\//i.test(v.trim()) ? v.trim().replace(/\/$/, "") : undefined);

function identityOf(data: Partial<Pick<ReferenceData, "doi" | "isbn" | "url">>, extraUrls: unknown[] = []): Identity {
	return {
		doi: data.doi ? normalizeDoi(String(data.doi))?.toLowerCase() : undefined,
		isbn: data.isbn ? canonicalIsbn(String(data.isbn)) ?? undefined : undefined,
		urls: [data.url, ...extraUrls].map(urlKey).filter((u): u is string => !!u),
	};
}

function sameIdentity(a: Identity, b: Identity): boolean {
	return (!!a.doi && a.doi === b.doi) || (!!a.isbn && a.isbn === b.isbn) || a.urls.some((u) => b.urls.includes(u));
}

/**
 * A citekey and identity claimed by a write that the metadata cache may not show yet.
 * Kept briefly: long enough for Obsidian to index the new frontmatter.
 */
interface Reservation extends Identity {
	file: TFile;
	citekey: string;
	until: number;
}
const RESERVATION_MS = 10_000;

/** Values used to name an attachment; anything missing is read from the note. */
export interface AttachmentNaming {
	citekey?: string;
	title?: string;
	familyNames?: string[];
	year?: number;
}

/** Equal property values (strings, numbers, lists) as YAML would hold them. */
function sameValue(a: unknown, b: unknown): boolean {
	return a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Bibliographic fields a lookup knows better than a clipper's guess from the page. */
/** Fields a refresh may update: everything bibliographic, nothing about your workflow. */
const REFRESH_FIELDS: PropertyKey[] = [
	"type", "title", "authors", "editors", "translators", "contributors", "year", "published", "publisher", "place",
	"journal", "volume", "issue", "pages", "edition", "series", "isbn", "issn", "doi", "url", "accessed", "language", "abstract",
];

const CLIPPED_FIELDS: PropertyKey[] = [
	"type", "title", "authors", "editors", "translators", "contributors", "year", "published", "publisher", "place",
	"journal", "volume", "issue", "pages", "edition", "series", "isbn", "issn", "doi", "language", "abstract",
];

/**
 * All vault operations on reference notes.
 *
 * Methods that choose a citekey or a path and then write (create, complete, attach,
 * regenerateCitekey) must run inside exclusive(), together with any duplicate check
 * they depend on, so that concurrent captures can't pick the same key or file.
 */
export class Library {
	private queue: Promise<unknown> = Promise.resolve();
	private reservations: Reservation[] = [];

	constructor(
		private app: App,
		private settings: () => LibrarySettings,
		private active: () => boolean = () => true
	) {}

	private get s(): LibrarySettings {
		return this.settings();
	}

	/** Run fn after every earlier exclusive operation has finished. Refuses to start once unloaded. */
	exclusive<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.queue.then(() => {
			if (!this.active()) throw new Cancelled();
			return fn();
		});
		this.queue = run.catch(() => undefined);
		return run;
	}

	private liveReservations(): Reservation[] {
		const now = Date.now();
		this.reservations = this.reservations.filter((r) => r.until > now && this.exists(r.file));
		return this.reservations;
	}

	private reserve(file: TFile, citekey: string, data: Partial<ReferenceData>, extraUrls: string[] = []): void {
		this.reservations.push({ file, citekey, ...identityOf(data, extraUrls), until: Date.now() + RESERVATION_MS });
	}

	/**
	 * Throw Cancelled if the plugin was unloaded. exclusive() checks once on entry; writers
	 * call this again after any await, right before touching the vault.
	 */
	private assertActive(): void {
		if (!this.active()) throw new Cancelled();
	}

	/** True while the TFile is still in the vault (not deleted or replaced). */
	exists(file: TFile): boolean {
		return this.app.vault.getAbstractFileByPath(file.path) === file;
	}

	prop(key: PropertyKey): string {
		return this.s.propertyNames[key] || key;
	}

	frontmatter(file: TFile): Frontmatter {
		return this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
	}

	inFolder(file: TFile, folder: string): boolean {
		const f = normalizePath(folder);
		return f === "/" || f === "" || file.path.startsWith(f + "/");
	}

	isReference(file: TFile): boolean {
		return file.extension === "md" && this.inFolder(file, this.s.referencesFolder);
	}

	referenceFiles(): TFile[] {
		return this.app.vault.getMarkdownFiles().filter((f) => this.isReference(f));
	}

	/** The note's citekey, including one just written that the metadata cache hasn't indexed yet. */
	citekeyOf(file: TFile): string {
		const reserved = [...this.liveReservations()].reverse().find((r) => r.file === file);
		return reserved?.citekey ?? asText(this.frontmatter(file)[this.prop("citekey")]).trim();
	}

	/** The identifier a note carries, preferring DOI, then ISBN, then URL. */
	identifierOf(file: TFile): Identifier | null {
		const fm = this.frontmatter(file);
		const doi = normalizeDoi(asText(fm[this.prop("doi")]));
		if (doi) return { kind: "doi", value: doi };
		const isbn = normalizeIsbn(asText(fm[this.prop("isbn")]));
		if (isbn) return { kind: "isbn", value: isbn };
		const url = asText(fm[this.prop("url")]).trim();
		if (/^https?:\/\//i.test(url)) return { kind: "url", value: url };
		return null;
	}

	/** Find an existing reference with the same DOI, ISBN (either form) or any of its URLs. */
	findExisting(data: Partial<Pick<ReferenceData, "doi" | "isbn" | "url">>, except?: TFile): TFile | null {
		const want = identityOf(data);
		if (!want.doi && !want.isbn && !want.urls.length) return null;
		for (const r of this.liveReservations()) if (r.file !== except && sameIdentity(want, r)) return r.file;
		for (const f of this.referenceFiles()) {
			if (f === except) continue;
			if (sameIdentity(want, this.noteIdentity(this.frontmatter(f)))) return f;
		}
		return null;
	}

	/** The mapped url plus any capture-URL properties (a clip keeps its "source"). */
	private noteIdentity(fm: Frontmatter): Identity {
		return identityOf(
			{ doi: fm[this.prop("doi")] as string | undefined, isbn: fm[this.prop("isbn")] as string | undefined },
			[fm[this.prop("url")], ...this.s.urlProperties.map((k) => fm[k])]
		);
	}

	/**
	 * findExisting, plus reference notes the metadata cache hasn't indexed yet, read from disk.
	 * A note another device filed can arrive through sync moments before a capture here;
	 * checking it keeps the same item from being filed twice. Call inside exclusive().
	 */
	async findExistingOnDisk(data: Partial<Pick<ReferenceData, "doi" | "isbn" | "url">>, except?: TFile): Promise<TFile | null> {
		const found = this.findExisting(data, except);
		if (found) return found;
		const want = identityOf(data);
		if (!want.doi && !want.isbn && !want.urls.length) return null;
		for (const f of this.referenceFiles()) {
			if (f === except || this.app.metadataCache.getFileCache(f)) continue;
			let fm: Frontmatter = {};
			try {
				const info = getFrontMatterInfo(await this.app.vault.read(f));
				fm = ((info.exists ? parseYaml(info.frontmatter) : null) ?? {}) as Frontmatter;
			} catch {
				continue; // unreadable or invalid YAML: Obsidian indexes such a note without properties
			}
			if (this.exists(f) && sameIdentity(want, this.noteIdentity(fm))) return f;
		}
		return null;
	}

	citekeyTaken(key: string, except?: TFile): boolean {
		const lower = key.toLowerCase();
		for (const r of this.liveReservations()) if (r.file !== except && r.citekey.toLowerCase() === lower) return true;
		for (const f of this.referenceFiles()) {
			if (f === except) continue;
			if (f.basename.toLowerCase() === lower) return true;
			if (asText(this.frontmatter(f)[this.prop("citekey")]).trim().toLowerCase() === lower) return true;
		}
		return false;
	}

	makeCitekey(data: Pick<ReferenceData, "title" | "familyNames" | "year">, except?: TFile): string {
		const key = generateCitekey({ title: data.title, authors: data.familyNames, year: data.year }, this.s.citekeyPattern);
		return disambiguate(key, (k) => this.citekeyTaken(k, except));
	}

	/** Citekey inputs from a note's existing properties (for regeneration and attachment names). */
	keyInputsFromNote(file: TFile): Pick<ReferenceData, "title" | "familyNames" | "year"> {
		const fm = this.frontmatter(file);
		// The authors, or the editors of an edited volume; names split by the rules in names.ts.
		const authors = namesFromProperty(fm[this.prop("authors")]);
		const people = authors.length ? authors : namesFromProperty(fm[this.prop("editors")]);
		return {
			title: asText(fm[this.prop("title")] ?? file.basename),
			familyNames: people.map(familyOf).filter(Boolean),
			year: Number(asText(fm[this.prop("year")]).match(/\d{4}/)?.[0]) || undefined,
		};
	}

	formatName(format: string, citekey: string, data: Partial<ReferenceData>): string {
		const name = format
			// Function replacers, so "$&" or "$1" in a title is not treated as a pattern.
			.replace(/\{\{citekey\}\}/g, () => citekey)
			.replace(/\{\{title\}\}/g, () => data.title ?? "")
			.replace(/\{\{year\}\}/g, () => (data.year ? String(data.year) : ""))
			.replace(/\{\{author\}\}/g, () => data.familyNames?.[0] ?? "");
		return safeFilename(name) || safeFilename(citekey) || "untitled";
	}

	/** Properties derived from looked-up data, keyed by real property names. */
	propertiesFor(data: ReferenceData, citekey: string, status?: string): Frontmatter {
		const p = (k: PropertyKey) => this.prop(k);
		const out: Frontmatter = {
			[p("citekey")]: citekey,
			[p("type")]: data.type,
			[p("title")]: data.title,
		};
		for (const k of PEOPLE_KEYS) {
			const list = this.peopleValues(data, k);
			if (list.length) out[p(k)] = list;
		}
		out[p("year")] = data.year;
		for (const k of TEXT_KEYS) out[p(k)] = data[k];
		Object.assign(out, {
			[p("isbn")]: data.isbn,
			[p("doi")]: data.doi,
			[p("url")]: data.url,
			[p("abstract")]: data.abstract,
			[p("status")]: status,
			[p("added")]: localDate(),
		});
		// Older settings may map the year to a date property; the full date wins there.
		if (data.date) out[p("published")] = data.date;
		for (const k of Object.keys(out)) if (isEmpty(out[k])) delete out[k];
		return out;
	}

	/**
	 * Fill empty properties. A property in `replaceIfUnchanged` is also overwritten when it
	 * still holds exactly that value (what a clipper wrote before a lookup started); a value
	 * changed since then is the user's edit and is kept.
	 */
	async fillProperties(file: TFile, props: Frontmatter, replaceIfUnchanged: Frontmatter = {}): Promise<void> {
		this.assertActive();
		await this.app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
			for (const [k, v] of Object.entries(props)) {
				const unchanged = Object.keys(replaceIfUnchanged).includes(k) && sameValue(fm[k], replaceIfUnchanged[k]);
				if (isEmpty(fm[k]) || unchanged) fm[k] = v;
			}
		});
	}

	/**
	 * Property values for one list of people: links or plain names (the "Authors as links"
	 * setting), with a sort form where a name wouldn't split right by rule (see names.ts).
	 */
	peopleValues(data: ReferenceData, key: PeopleKey): string[] {
		const display = key === "authors" ? data.authors : data[key] ?? [];
		const parts = data.names?.[key] ?? [];
		return display
			.map((d, i) => nameValue(parts[i] ?? parseName(d), this.s.authorsAsLinks))
			.filter(Boolean);
	}

	async renderBody(data: ReferenceData, citekey: string): Promise<string> {
		let template = DEFAULT_TEMPLATE;
		if (this.s.templatePath) {
			const t = this.app.vault.getAbstractFileByPath(normalizePath(this.s.templatePath));
			if (t instanceof TFile) template = await this.app.vault.read(t);
		}
		// Everything except the citekey and year comes from a remote source, so escape it.
		const e = (v: string | undefined) => (v === undefined ? undefined : escapeMarkdown(v));
		return renderTemplate(template, {
			citekey,
			title: e(data.title),
			authors: data.authors.map(escapeMarkdown),
			editors: (data.editors ?? []).map(escapeMarkdown),
			translators: (data.translators ?? []).map(escapeMarkdown),
			year: data.year,
			volume: e(data.volume),
			issue: e(data.issue),
			pages: e(data.pages),
			edition: e(data.edition),
			place: e(data.place),
			series: e(data.series),
			language: e(data.language),
			accessed: e(data.accessed),
			published: e(data.date),
			publisher: e(data.publisher),
			journal: e(data.journal),
			url: markdownSafeUrl(data.url),
			doi: e(data.doi),
			isbn: e(data.isbn),
			abstract: e(data.abstract),
			type: e(data.type),
		});
	}

	async ensureFolder(path: string): Promise<void> {
		const p = normalizePath(path);
		if (!p || p === "/" || this.app.vault.getAbstractFileByPath(p) instanceof TFolder) return;
		const parts = p.split("/");
		for (let i = 1; i <= parts.length; i++) {
			const sub = parts.slice(0, i).join("/");
			if (!this.app.vault.getAbstractFileByPath(sub)) {
				this.assertActive();
				await this.app.vault.createFolder(sub);
			}
		}
	}

	/** A free path in folder for basename.ext, adding " 1", " 2" if needed. */
	freePath(folder: string, basename: string, ext: string, except?: TFile): string {
		let candidate = normalizePath(`${folder}/${basename}.${ext}`);
		for (let i = 1; this.app.vault.getAbstractFileByPath(candidate) && this.app.vault.getAbstractFileByPath(candidate) !== except; i++) {
			candidate = normalizePath(`${folder}/${basename} ${i}.${ext}`);
		}
		return candidate;
	}

	/** Move/rename through the file manager so links update. */
	async moveTo(file: TFile, folder: string, basename: string): Promise<TFile> {
		await this.ensureFolder(folder);
		const target = this.freePath(folder, basename, file.extension, file);
		if (target !== file.path) {
			this.assertActive();
			await this.app.fileManager.renameFile(file, target);
		}
		return file;
	}

	/** Create a new reference note from looked-up data. Call inside exclusive(). */
	async create(data: ReferenceData, status: string): Promise<TFile> {
		const citekey = this.makeCitekey(data);
		const folder = this.s.referencesFolder;
		await this.ensureFolder(folder);
		const body = await this.renderBody(data, citekey);
		const path = this.freePath(folder, this.formatName(this.s.filenameFormat, citekey, data), "md");
		// Reading a template can take a while; don't create the note if we were unloaded meanwhile.
		this.assertActive();
		const file = await this.app.vault.create(path, body);
		this.reserve(file, citekey, data);
		await this.fillProperties(file, this.propertiesFor(data, citekey, status));
		return file;
	}

	/**
	 * Fill an existing note from looked-up data, give it a citekey if it lacks one,
	 * and move it into the references folder under the configured filename.
	 * `captureUrls` are other URLs the note was captured from, counted for duplicate
	 * detection until the cache indexes the note (afterwards its url properties are read).
	 * `clipped` is the note's frontmatter as a clipper wrote it, read before the lookup: its
	 * bibliographic values (page title, a truncated description) are replaced by looked-up
	 * ones unless they were edited since. The URL and status are kept.
	 * Call inside exclusive().
	 */
	async complete(file: TFile, data: ReferenceData | null, status?: string, captureUrls: string[] = [], clipped?: Frontmatter): Promise<TFile> {
		const fm = this.frontmatter(file);
		const existingKey = asText(fm[this.prop("citekey")]).trim();
		// Without looked-up data, the note's own properties name it (a manual reference, #16).
		const basis: ReferenceData = data ?? { ...this.keyInputsFromNote(file), type: "", authors: [], source: "note" };
		const citekey = existingKey || this.makeCitekey(basis, file);
		this.reserve(file, citekey, basis, captureUrls);
		const replace: Frontmatter = {};
		if (clipped) for (const k of CLIPPED_FIELDS) replace[this.prop(k)] = clipped[this.prop(k)];
		await this.fillProperties(file, this.propertiesFor(basis, citekey, isEmpty(fm[this.prop("status")]) ? status : undefined), replace);
		// Notes already inside the references folder keep their subfolder.
		const folder = this.isReference(file) ? file.parent?.path ?? this.s.referencesFolder : this.s.referencesFolder;
		return this.moveTo(file, folder, this.formatName(this.s.filenameFormat, citekey, basis));
	}

	/**
	 * What a fresh lookup would change on a note, field by field. Never includes the citekey,
	 * status, files or date added.
	 */
	refreshChanges(file: TFile, data: ReferenceData): FieldChange[] {
		const proposed = this.propertiesFor(data, this.citekeyOf(file) || file.basename);
		const fields = REFRESH_FIELDS.map((k) => [this.prop(k), FIELD_LABELS[k]] as [string, string]);
		return compareProperties(this.frontmatter(file), proposed, fields);
	}

	/** Write the chosen changes from refreshChanges; the note body is untouched. */
	async applyChanges(file: TFile, changes: FieldChange[]): Promise<void> {
		if (!changes.length) return;
		this.assertActive();
		await this.app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
			for (const c of changes) fm[c.property] = c.proposed;
		});
	}

	/** A link from note to target that resolves to target even when its basename isn't unique. */
	linkTo(target: TFile, note: TFile): string {
		return `[[${this.app.metadataCache.fileToLinktext(target, note.path, false)}]]`;
	}

	/** True if a link-ish property value resolves to target from note. */
	private linksTo(value: unknown, target: TFile, note: TFile): boolean {
		const linkpath = unlink(value);
		return !!linkpath && this.app.metadataCache.getFirstLinkpathDest(linkpath, note.path) === target;
	}

	/**
	 * File an attachment under the configured name and link it from the note.
	 * Values set on the note win; `known` fills in what the metadata cache hasn't indexed yet
	 * (a just-created or just-reserved note). Call inside exclusive().
	 */
	async attach(note: TFile, attachment: TFile, known: AttachmentNaming = {}): Promise<void> {
		await this.moveTo(attachment, this.s.attachmentsFolder, this.attachmentName(note, known));
		await this.linkAttachment(note, attachment, true);
	}

	/**
	 * A file already in the vault with the same bytes as `attachment`, at the name attach()
	 * would give it or linked as the note's pdf. Another device (or a backup restore) filed
	 * it already, so filing this copy too would only add "name 1.pdf".
	 */
	async alreadyFiled(note: TFile, attachment: TFile, known: AttachmentNaming = {}): Promise<TFile | null> {
		const target = normalizePath(`${this.s.attachmentsFolder}/${this.attachmentName(note, known)}.${attachment.extension}`);
		const pdf = unlink(this.frontmatter(note)[this.prop("pdf")]);
		const candidates = [this.app.vault.getAbstractFileByPath(target), pdf ? this.app.metadataCache.getFirstLinkpathDest(pdf, note.path) : null];
		let bytes: Uint8Array | null = null;
		for (const c of candidates) {
			if (!(c instanceof TFile) || c === attachment || c.extension !== attachment.extension) continue;
			bytes ??= new Uint8Array(await this.app.vault.readBinary(attachment));
			if (sameBytes(bytes, new Uint8Array(await this.app.vault.readBinary(c)))) return c;
		}
		return null;
	}

	/** The filename (without extension) attach() gives an attachment of this note. */
	private attachmentName(note: TFile, known: AttachmentNaming): string {
		const fm = this.frontmatter(note);
		const fromNote = this.keyInputsFromNote(note);
		const noteTitle = asText(fm[this.prop("title")]).trim();
		const citekey = this.citekeyOf(note) || known.citekey || note.basename;
		const naming: Partial<ReferenceData> = {
			title: noteTitle || known.title || "",
			familyNames: fromNote.familyNames.length ? fromNote.familyNames : known.familyNames ?? [],
			year: fromNote.year ?? known.year,
		};
		return this.formatName(this.s.attachmentFilenameFormat, citekey, naming);
	}

	/**
	 * Add a link to the file to the note's attachments list (once), and make it the pdf when
	 * `primary` and the note has none. The file keeps its name.
	 */
	async linkAttachment(note: TFile, attachment: TFile, primary = false): Promise<void> {
		const link = this.linkTo(attachment, note);
		this.assertActive();
		await this.app.fileManager.processFrontMatter(note, (f: Frontmatter) => {
			const pdfKey = this.prop("pdf");
			if (primary && attachment.extension === "pdf" && isEmpty(f[pdfKey])) f[pdfKey] = link;
			const listKey = this.prop("attachments");
			const current = f[listKey];
			// Keep a single existing value rather than replacing it.
			const list: unknown[] = Array.isArray(current) ? current : isEmpty(current) ? [] : [current];
			if (!list.some((v) => this.linksTo(v, attachment, note))) f[listKey] = [...list, link];
		});
	}

	/** Recompute the citekey from the note's own properties, then rename. Call inside exclusive(). */
	async regenerateCitekey(file: TFile): Promise<string> {
		const inputs = this.keyInputsFromNote(file);
		const key = this.makeCitekey(inputs, file);
		this.reserve(file, key, {});
		this.assertActive();
		await this.app.fileManager.processFrontMatter(file, (f: Frontmatter) => {
			f[this.prop("citekey")] = key;
		});
		await this.moveTo(file, file.parent?.path ?? this.s.referencesFolder, this.formatName(this.s.filenameFormat, key, inputs));
		return key;
	}
}
