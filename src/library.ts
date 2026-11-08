import { App, TFile, TFolder, moment, normalizePath } from "obsidian";
import { disambiguate, familyFromFullName, generateCitekey } from "./citekey";
import { Identifier, normalizeDoi, normalizeIsbn } from "./identifiers";
import { ReferenceData } from "./metadata/types";
import { LibrarySettings, PropertyKey } from "./settings";
import { DEFAULT_TEMPLATE, renderTemplate, safeFilename } from "./template";

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

/** All vault operations on reference notes. */
export class Library {
	constructor(private app: App, private settings: () => LibrarySettings) {}

	private get s(): LibrarySettings {
		return this.settings();
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

	/** Find an existing reference with the same DOI, ISBN or URL. */
	findExisting(data: Pick<ReferenceData, "doi" | "isbn" | "url">, except?: TFile): TFile | null {
		const doi = data.doi?.toLowerCase();
		const isbn = data.isbn;
		const url = data.url?.replace(/\/$/, "");
		for (const f of this.referenceFiles()) {
			if (f === except) continue;
			const fm = this.frontmatter(f);
			if (doi && String(fm[this.prop("doi")] ?? "").toLowerCase() === doi) return f;
			if (isbn && normalizeIsbn(String(fm[this.prop("isbn")] ?? "")) === isbn) return f;
			if (url && String(fm[this.prop("url")] ?? "").replace(/\/$/, "") === url) return f;
		}
		return null;
	}

	citekeyTaken(key: string, except?: TFile): boolean {
		const lower = key.toLowerCase();
		for (const f of this.referenceFiles()) {
			if (f === except) continue;
			if (f.basename.toLowerCase() === lower) return true;
			if (String(this.frontmatter(f)[this.prop("citekey")] ?? "").toLowerCase() === lower) return true;
		}
		return false;
	}

	makeCitekey(data: Pick<ReferenceData, "title" | "familyNames" | "year">, except?: TFile): string {
		const key = generateCitekey({ title: data.title, authors: data.familyNames, year: data.year }, this.s.citekeyPattern);
		return disambiguate(key, (k) => this.citekeyTaken(k, except));
	}

	/** Citekey inputs from a note's existing properties (for regeneration). */
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
			.replace(/\{\{citekey\}\}/g, citekey)
			.replace(/\{\{title\}\}/g, data.title ?? "")
			.replace(/\{\{year\}\}/g, data.year ? String(data.year) : "")
			.replace(/\{\{author\}\}/g, data.familyNames?.[0] ?? "");
		return safeFilename(name) || citekey;
	}

	/** Properties derived from looked-up data, keyed by real property names. */
	propertiesFor(data: ReferenceData, citekey: string, status?: string): Frontmatter {
		const p = (k: PropertyKey) => this.prop(k);
		const authors = data.authors.map((a) => (this.s.authorsAsLinks ? `[[${a}]]` : a));
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
		return renderTemplate(template, {
			citekey,
			title: data.title,
			authors: data.authors,
			year: data.year,
			publisher: data.publisher,
			journal: data.journal,
			url: data.url,
			doi: data.doi,
			isbn: data.isbn,
			abstract: data.abstract,
			type: data.type,
		});
	}

	async ensureFolder(path: string): Promise<void> {
		const p = normalizePath(path);
		if (!p || p === "/" || this.app.vault.getAbstractFileByPath(p) instanceof TFolder) return;
		const parts = p.split("/");
		for (let i = 1; i <= parts.length; i++) {
			const sub = parts.slice(0, i).join("/");
			if (!this.app.vault.getAbstractFileByPath(sub)) await this.app.vault.createFolder(sub);
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
		if (target !== file.path) await this.app.fileManager.renameFile(file, target);
		return file;
	}

	/** Create a new reference note from looked-up data. */
	async create(data: ReferenceData, status: string): Promise<TFile> {
		const citekey = this.makeCitekey(data);
		const folder = this.s.referencesFolder;
		await this.ensureFolder(folder);
		const path = this.freePath(folder, this.formatName(this.s.filenameFormat, citekey, data), "md");
		const file = await this.app.vault.create(path, await this.renderBody(data, citekey));
		await this.fillProperties(file, this.propertiesFor(data, citekey, status));
		return file;
	}

	/**
	 * Fill an existing note from looked-up data, give it a citekey if it lacks one,
	 * and move it into the references folder under the configured filename.
	 */
	async complete(file: TFile, data: ReferenceData | null, status?: string): Promise<TFile> {
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
		await this.fillProperties(file, this.propertiesFor(basis, citekey, isEmpty(fm[this.prop("status")]) ? status : undefined));
		// Notes already inside the references folder keep their subfolder.
		const folder = this.isReference(file) ? file.parent?.path ?? this.s.referencesFolder : this.s.referencesFolder;
		return this.moveTo(file, folder, this.formatName(this.s.filenameFormat, citekey, basis));
	}

	/** File an attachment under the configured name and link it from the note. */
	async attach(note: TFile, attachment: TFile): Promise<void> {
		const fm = this.frontmatter(note);
		const citekey = String(fm[this.prop("citekey")] ?? note.basename);
		const base = this.formatName(this.s.attachmentFilenameFormat, citekey, { title: String(fm[this.prop("title")] ?? "") });
		await this.moveTo(attachment, this.s.attachmentsFolder, base);
		const link = `[[${attachment.name}]]`;
		await this.app.fileManager.processFrontMatter(note, (f: Frontmatter) => {
			if (attachment.extension === "pdf" && isEmpty(f[this.prop("pdf")])) f[this.prop("pdf")] = link;
			const list = Array.isArray(f[this.prop("attachments")]) ? (f[this.prop("attachments")] as string[]) : [];
			if (!list.includes(link)) f[this.prop("attachments")] = [...list, link];
		});
	}

	/** Recompute the citekey from the note's own properties, then rename. */
	async regenerateCitekey(file: TFile): Promise<string> {
		const inputs = this.keyInputsFromNote(file);
		const key = this.makeCitekey(inputs, file);
		await this.app.fileManager.processFrontMatter(file, (f: Frontmatter) => {
			f[this.prop("citekey")] = key;
		});
		await this.moveTo(file, file.parent?.path ?? this.s.referencesFolder, this.formatName(this.s.filenameFormat, key, inputs));
		return key;
	}
}
