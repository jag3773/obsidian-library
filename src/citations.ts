/**
 * Citing while writing (#21) and formatted citations (#20): the commands, menus and vault
 * access around the pure modules cite.ts and csl.ts.
 */
import { App, Command, Editor, EventRef, MarkdownFileInfo, MarkdownView, Menu, Notice, TAbstractFile, TFile, TFolder, normalizePath, parseYaml } from "obsidian";
import { BaseConfig, baseFolder, validateBase } from "./bases";
import { CslItem, noteToCsl } from "./citation";
import { CiteChoice, CiteRef, appendToPandoc, citeRef, formatCite, pandocCitationAt, pandocKey, pandocKeysIn, wikilinkTargetsIn } from "./cite";
import { BUNDLED_STYLE_TITLE, CslProcessor, Formatted, bundledStyle, copyFormatted, incomplete } from "./csl";
import { Library } from "./library";
import { LibrarySettings } from "./settings";
import { CitationSuggest, LocatorModal } from "./ui/CitationSuggest";

const PREFIX = "Stacks";

/** What the plugin offers this module. */
export interface CitationHost {
	app: App;
	library: Library;
	settings: LibrarySettings;
	addCommand(command: Command): Command;
	registerEvent(ref: EventRef): void;
}

/** Which references a bibliography covers, and citekeys a draft cites that aren't in the library. */
export interface Scope {
	files: TFile[];
	label: string;
	missing: string[];
}

export class Citations {
	/** The processor for the current style and locale files, rebuilt when either changes. */
	private cached: { key: string; processor: Promise<CslProcessor> } | null = null;

	constructor(private host: CitationHost) {}

	private get app(): App {
		return this.host.app;
	}
	private get library(): Library {
		return this.host.library;
	}
	private get settings(): LibrarySettings {
		return this.host.settings;
	}

	/** Commands and menu items. Called once from onload. */
	register(): void {
		const h = this.host;
		h.addCommand({
			id: "insert-citation",
			name: "Insert citation",
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => this.insert(editor, ctx.file?.path ?? ""),
		});
		h.addCommand({
			id: "copy-formatted-citation",
			name: "Copy formatted citation for current reference",
			checkCallback: (checking) => {
				const file = this.activeReference();
				if (!file) return false;
				if (!checking) void this.copy({ files: [file], label: file.basename, missing: [] }, "citation");
				return true;
			},
		});
		h.addCommand({
			id: "copy-formatted-bibliography",
			name: "Copy formatted bibliography",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || (file.extension !== "md" && file.extension !== "base")) return false;
				if (!checking) void this.scopeOf(file).then((scope) => this.copy(scope, "bibliography"), (e) => this.report(e));
				return true;
			},
		});
		h.addCommand({
			id: "copy-pandoc-citation",
			name: "Copy citekey as Pandoc citation",
			checkCallback: (checking) => {
				const file = this.activeReference();
				const key = file ? this.library.citekeyOf(file) : "";
				if (!key) return false;
				if (!checking)
					void navigator.clipboard.writeText(`[${pandocKey(key)}]`).then(
						() => new Notice(`${PREFIX}: copied [${pandocKey(key)}]`),
						(e) => this.report(e)
					);
				return true;
			},
		});
		// Several references selected in the file explorer.
		h.registerEvent(
			this.app.workspace.on("files-menu", (menu: Menu, files: TAbstractFile[]) => {
				const refs = files.filter((f): f is TFile => f instanceof TFile && this.library.isReference(f));
				if (!refs.length) return;
				menu.addItem((item) =>
					item
						.setTitle("Copy formatted bibliography")
						.setIcon("quote")
						.onClick(() => void this.copy({ files: refs, label: `${refs.length} selected`, missing: [] }, "bibliography"))
				);
			})
		);
		// A folder, a base, or a draft that cites references.
		h.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
				if (!(file instanceof TFolder) && !(file instanceof TFile && (file.extension === "md" || file.extension === "base"))) return;
				menu.addItem((item) =>
					item
						.setTitle("Copy formatted bibliography")
						.setIcon("quote")
						.onClick(() => void this.scopeOf(file).then((scope) => this.copy(scope, "bibliography"), (e) => this.report(e)))
				);
			})
		);
	}

	private report(e: unknown): void {
		console.error(`[${PREFIX}]`, e);
		new Notice(`${PREFIX}: ${e instanceof Error ? e.message : String(e)}`);
	}

	private activeReference(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		return file && this.library.isReference(file) ? file : null;
	}

	// ------------------------------------------------------------ formatting (#20)

	/** Read a vault file the settings name, with a message that says which setting is wrong. */
	private async readSetting(path: string, what: string): Promise<string> {
		const target = normalizePath(path.trim());
		try {
			return await this.app.vault.adapter.read(target);
		} catch {
			throw new Error(`couldn't read the ${what} ${target}. Check the path in the Stacks settings.`);
		}
	}

	/** The CSL processor for the configured style and locale, built on first use and reused. */
	async processor(): Promise<CslProcessor> {
		const s = this.settings;
		const style = s.citationStyle.trim() ? await this.readSetting(s.citationStyle, "citation style") : await bundledStyle();
		const locale = s.citationLocale.trim() ? await this.readSetting(s.citationLocale, "citation locale") : "";
		const key = `${style}\u0000${locale}`;
		if (this.cached?.key !== key) {
			const processor = CslProcessor.create({ style, locales: locale ? [locale] : [] });
			this.cached = { key, processor };
			// A broken style shouldn't stay cached; the next attempt reads the file again.
			processor.catch(() => {
				if (this.cached?.processor === processor) this.cached = null;
			});
		}
		return this.cached.processor;
	}

	/** Citation records for the files, in order, one per citekey. */
	items(files: TFile[]): { items: CslItem[]; skipped: string[] } {
		const items: CslItem[] = [];
		const skipped: string[] = [];
		const seen = new Set<string>();
		for (const f of files) {
			const item = noteToCsl(this.library.frontmatter(f), this.settings.propertyNames);
			if (!item) skipped.push(f.basename);
			else if (!seen.has(item.id)) {
				seen.add(item.id);
				items.push(item);
			}
		}
		return { items, skipped };
	}

	/** Format the scope as a citation or a bibliography in the configured style. */
	async format(scope: Scope, kind: "citation" | "bibliography"): Promise<{ formatted: Formatted; items: CslItem[]; skipped: string[]; style: string }> {
		const { items, skipped } = this.items(scope.files);
		if (!items.length) throw new Error(`no references with a citekey in ${scope.label}.`);
		const processor = await this.processor();
		const formatted = kind === "citation" ? processor.citation(items) : processor.bibliography(items);
		return { formatted, items, skipped, style: processor.title ?? BUNDLED_STYLE_TITLE };
	}

	/** Copy a formatted citation or bibliography, as HTML and plain text, and say what was left out or is incomplete. */
	async copy(scope: Scope, kind: "citation" | "bibliography"): Promise<void> {
		const pending = new Notice(`${PREFIX}: formatting…`, 0);
		try {
			const { formatted, items, skipped, style } = await this.format(scope, kind);
			await copyFormatted(navigator.clipboard, formatted);
			const what = kind === "citation" ? "citation" : `bibliography of ${items.length} ${items.length === 1 ? "reference" : "references"}`;
			const notes = [`${PREFIX}: copied ${what} (${style}).`];
			if (scope.missing.length) notes.push(`Not in your library: ${list(scope.missing)}.`);
			if (skipped.length) notes.push(`No citekey: ${list(skipped)}.`);
			const lacking = incomplete(items);
			if (lacking.length) notes.push(`Incomplete: ${list(lacking)}.`);
			new Notice(notes.join(" "), lacking.length || scope.missing.length ? 10000 : undefined);
		} catch (e) {
			this.report(e);
		} finally {
			pending.hide();
		}
	}

	/** References a reference note, folder, base or draft stands for. */
	async scopeOf(file: TAbstractFile): Promise<Scope> {
		if (file instanceof TFolder) {
			const folder = file.path;
			return { files: this.library.referenceFiles().filter((f) => this.library.inFolder(f, folder)), label: folder, missing: [] };
		}
		if (!(file instanceof TFile)) return { files: [], label: file.path, missing: [] };
		if (this.library.isReference(file)) return { files: [file], label: file.basename, missing: [] };
		if (file.extension === "base") return this.baseScope(file);
		return this.citedBy(file);
	}

	/**
	 * A base's references: the reference notes in the folder the base requires, or the whole
	 * library when it doesn't require one. A view's other filters aren't applied: plugins
	 * can't read the rows a Bases view shows.
	 */
	private async baseScope(file: TFile): Promise<Scope> {
		let folder: string | null = null;
		try {
			const parsed: unknown = parseYaml(await this.app.vault.read(file));
			if (!validateBase(parsed)) folder = baseFolder(parsed as BaseConfig);
		} catch {
			// An unreadable base covers the library, like a base without a folder filter.
		}
		const refs = this.library.referenceFiles();
		return folder
			? { files: refs.filter((f) => this.library.inFolder(f, folder)), label: folder, missing: [] }
			: { files: refs, label: "the library", missing: [] };
	}

	/** References a draft cites with [[links]] or Pandoc @keys, in order of first appearance. */
	async citedBy(file: TFile): Promise<Scope> {
		const text = await this.app.vault.cachedRead(file);
		const byKey = new Map<string, TFile>();
		for (const f of this.library.referenceFiles()) {
			const key = this.library.citekeyOf(f);
			if (key && !byKey.has(key)) byKey.set(key, f);
		}
		const found: { file: TFile; offset: number }[] = [];
		const missing: string[] = [];
		for (const { target, offset } of wikilinkTargetsIn(text)) {
			const dest = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
			if (dest && this.library.isReference(dest)) found.push({ file: dest, offset });
		}
		for (const { key, offset } of pandocKeysIn(text)) {
			const dest = byKey.get(key);
			if (dest) found.push({ file: dest, offset });
			else missing.push(key);
		}
		found.sort((a, b) => a.offset - b.offset);
		return { files: [...new Set(found.map((f) => f.file))], label: file.basename, missing };
	}

	// ------------------------------------------------------------ inserting (#21)

	/** Reference notes as the picker searches them, from the metadata cache. */
	refs(): CiteRef[] {
		const out: CiteRef[] = [];
		for (const f of this.library.referenceFiles()) {
			const ref = citeRef(this.library.frontmatter(f), this.settings.propertyNames, f.path);
			if (ref) out.push(ref);
		}
		return out;
	}

	/** Pick a reference, optionally a locator, and insert the citation at the cursor. */
	insert(editor: Editor, sourcePath: string): void {
		const refs = this.refs();
		if (!refs.length) {
			new Notice(`${PREFIX}: no reference notes with a citekey in ${this.settings.referencesFolder}.`);
			return;
		}
		new CitationSuggest(this.app, refs, (ref) => {
			const choice: CiteChoice = { key: ref.key, link: this.linkText(ref, sourcePath) };
			if (!this.settings.citeAskLocator) this.write(editor, [choice]);
			else new LocatorModal(this.app, ref.key, (locator) => this.write(editor, [{ ...choice, locator }])).open();
		}).open();
	}

	/** How a link from the draft reaches the reference note: its shortest unambiguous link text. */
	private linkText(ref: CiteRef, sourcePath: string): string {
		const file = this.app.vault.getAbstractFileByPath(ref.path);
		return file instanceof TFile ? this.app.metadataCache.fileToLinktext(file, sourcePath, true) : ref.key;
	}

	/**
	 * Insert the citation. With the cursor inside a Pandoc citation ([@a]), the reference joins
	 * it ([@a; @b]) instead of starting a new one.
	 */
	write(editor: Editor, choices: CiteChoice[]): void {
		const format = this.settings.citeFormat;
		const cursor = editor.getCursor();
		const inside = format === "wikilink" ? undefined : pandocCitationAt(editor.getLine(cursor.line), cursor.ch);
		if (!inside) {
			editor.replaceSelection(formatCite(choices, format));
			return;
		}
		const added = appendToPandoc(choices);
		const links = format === "both" ? " " + formatCite(choices.map((c) => ({ ...c, locator: undefined })), "wikilink") : "";
		editor.replaceRange(added, { line: cursor.line, ch: inside.end });
		if (links) editor.replaceRange(links, { line: cursor.line, ch: inside.end + added.length + 1 });
		editor.setCursor({ line: cursor.line, ch: inside.end + added.length + 1 + links.length });
	}
}

/** The first few entries of a list, then a count of the rest. */
function list(items: string[], max = 3): string {
	return items.length <= max ? items.join("; ") : `${items.slice(0, max).join("; ")} and ${items.length - max} more`;
}
