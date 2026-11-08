import { App, TFile, TFolder, moment, normalizePath } from "obsidian";
import { disambiguate, familyFromFullName, generateCitekey } from "./citekey";
import { Identifier, canonicalIsbn, normalizeDoi, normalizeIsbn } from "./identifiers";
import { ReferenceData } from "./metadata/types";
import { LibrarySettings, PropertyKey } from "./settings";
import { DEFAULT_TEMPLATE, escapeMarkdown, markdownSafeUrl, renderTemplate, safeFilename } from "./template";

type Frontmatter = Record<string, unknown>;

const isEmpty = (v: unknown) =>
	v === undefined || v === null || v === "" || (Array.isArray(v) && v.filter((x) => x !== null && x !== "").length === 0);

/** Strip [[ ]] and aliases from a link-ish property value. */
export function unlink(v: unknown): string {
	return String(v ?? "")
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
		return (this.app.metadataCache.getFileCache(file)?.frontmatter as Frontmatter | undefined) ?? {};
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
		return reserved?.citekey ?? String(this.frontmatter(file)[this.prop("citekey")] ?? "").trim();
	}

	/** The identifier a note carries, preferring DOI, then ISBN, then URL. */
	identifierOf(file: TFile): Identifier | null {
		const fm = this.frontmatter(file);
		const doi = normalizeDoi(String(fm[this.prop("doi")] ?? ""));
		if (doi) return { kind: "doi", value: doi };
		const isbn = normalizeIsbn(String(fm[this.prop("isbn")] ?? ""));
		if (isbn) return { kind: "isbn", value: isbn };
		const url = String(fm[this.prop("url")] ?? "").trim();
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
			const fm = this.frontmatter(f);
			// The mapped url plus any capture-URL properties (a clip keeps its "source").
			const have = identityOf(
				{ doi: fm[this.prop("doi")] as string | undefined, isbn: fm[this.prop("isbn")] as string | undefined },
				[fm[this.prop("url")], ...this.s.urlProperties.map((k) => fm[k])]
			);
			if (sameIdentity(want, have)) return f;
		}
		return null;
	}

	citekeyTaken(key: string, except?: TFile): boolean {
		const lower = key.toLowerCase();
		for (const r of this.liveReservations()) if (r.file !== except && r.citekey.toLowerCase() === lower) return true;
		for (const f of this.referenceFiles()) {
			if (f === except) continue;
			if (f.basename.toLowerCase() === lower) return true;
			if (String(this.frontmatter(f)[this.prop("citekey")] ?? "").trim().toLowerCase() === lower) return true;
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
		const raw = fm[this.prop("authors")];
		const authors = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(unlink).filter(Boolean);
		return {
			title: String(fm[this.prop("title")] ?? file.basename),
			familyNames: authors.map(familyFromFullName),
			year: Number(String(fm[this.prop("year")] ?? "").match(/\d{4}/)?.[0]) || undefined,
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
		// Characters that would break or redirect a wikilink are dropped from link targets.
		const authors = data.authors
			.map((a) => (this.s.authorsAsLinks ? a.replace(/[[\]|#^\\/:]/g, " ").replace(/\s+/g, " ").trim() : a))
			.filter(Boolean)
			.map((a) => (this.s.authorsAsLinks ? `[[${a}]]` : a));
		const out: Frontmatter = {
			[p("citekey")]: citekey,
			[p("type")]: data.type,
			[p("title")]: data.title,
			[p("authors")]: authors.length ? authors : undefined,
			[p("year")]: data.year,
			[p("publisher")]: data.publisher,
			[p("journal")]: data.journal,
			[p("isbn")]: data.isbn,
			[p("doi")]: data.doi,
			[p("url")]: data.url,
			[p("status")]: status,
			[p("added")]: moment().format("YYYY-MM-DD"),
		};
		for (const k of Object.keys(out)) if (isEmpty(out[k])) delete out[k];
		return out;
	}

	/** Fill empty properties only. Never overwrites a value the user set. */
	async fillProperties(file: TFile, props: Frontmatter): Promise<void> {
		this.assertActive();
		await this.app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
			for (const [k, v] of Object.entries(props)) if (isEmpty(fm[k])) fm[k] = v;
		});
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
			year: data.year,
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
	 * Call inside exclusive().
	 */
	async complete(file: TFile, data: ReferenceData | null, status?: string, captureUrls: string[] = []): Promise<TFile> {
		const fm = this.frontmatter(file);
		const existingKey = String(fm[this.prop("citekey")] ?? "").trim();
		const basis: ReferenceData = data ?? {
			type: "webpage",
			title: String(fm[this.prop("title")] ?? file.basename),
			authors: [],
			familyNames: [],
			source: "note",
		};
		const citekey = existingKey || this.makeCitekey(basis, file);
		this.reserve(file, citekey, basis, captureUrls);
		await this.fillProperties(file, this.propertiesFor(basis, citekey, isEmpty(fm[this.prop("status")]) ? status : undefined));
		// Notes already inside the references folder keep their subfolder.
		const folder = this.isReference(file) ? file.parent?.path ?? this.s.referencesFolder : this.s.referencesFolder;
		return this.moveTo(file, folder, this.formatName(this.s.filenameFormat, citekey, basis));
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
		const fm = this.frontmatter(note);
		const fromNote = this.keyInputsFromNote(note);
		const noteTitle = String(fm[this.prop("title")] ?? "").trim();
		const citekey = this.citekeyOf(note) || known.citekey || note.basename;
		const naming: Partial<ReferenceData> = {
			title: noteTitle || known.title || "",
			familyNames: fromNote.familyNames.length ? fromNote.familyNames : known.familyNames ?? [],
			year: fromNote.year ?? known.year,
		};
		await this.moveTo(attachment, this.s.attachmentsFolder, this.formatName(this.s.attachmentFilenameFormat, citekey, naming));
		const link = this.linkTo(attachment, note);
		this.assertActive();
		await this.app.fileManager.processFrontMatter(note, (f: Frontmatter) => {
			const pdfKey = this.prop("pdf");
			if (attachment.extension === "pdf" && isEmpty(f[pdfKey])) f[pdfKey] = link;
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
