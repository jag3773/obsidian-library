import { App, Platform, PluginSettingTab, Setting, TFile, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import { BaseConfig, baseDisplayNames, baseFolder, basePropertyNames, matchProperties, starterBase, validateBase } from "./bases";
import { BibFormat, FORMAT_EXTENSIONS, FORMAT_LABELS, parseFilter } from "./bibliography";
import { parsePattern } from "./citekey";
import { DEFAULT_IMPORT_CHOICES, ImportChoices } from "./zotero";
import type LibraryPlugin from "./main";
import { PathSuggest, filePaths, folderPaths } from "./ui/PathSuggest";

import { DEFAULT_COLOR_MAP, parseColorMap } from "./annotations";
import { DEFAULT_PROPERTY_NAMES, FIELD_LABELS, PROPERTY_KEYS, PropertyKey } from "./properties";
import type { SentRecord } from "./roundtrip";

export { PROPERTY_KEYS };
export type { PropertyKey };

export interface LibrarySettings {
	referencesFolder: string;
	attachmentsFolder: string;
	inboxFolder: string;
	filenameFormat: string;
	attachmentFilenameFormat: string;
	citekeyPattern: string;
	templatePath: string;
	/** The .base file that shows the library; its folder and properties drive the field mapping. */
	libraryBase: string;
	authorsAsLinks: boolean;
	statuses: string[];
	defaultStatus: string;
	clipStatus: string;
	processInboxAutomatically: boolean;
	completeOnPropertyEdit: boolean;
	urlProperties: string[];
	crossrefMailto: string;
	propertyNames: Record<PropertyKey, string>;
	/** Bibliography file, relative to the vault root. */
	exportPath: string;
	exportFormat: BibFormat;
	/** "property: value, value" limits the bibliography to matching notes; empty exports all. */
	exportFilter: string;
	/** Rewrite the bibliography a few seconds after reference notes change. */
	autoExport: boolean;
	/** The last Zotero import's choices, so a re-run starts from them. */
	zoteroImport: ImportChoices;
	/** Backup of the last Zotero import, for undo. */
	lastImportBackup: string;

	// Annotations
	/** Heading the generated annotations go under; the plugin owns only what is between its markers. */
	annotationsHeading: string;
	/** "color: callout, Label" lines. */
	colorMap: string;
	/** Status set after annotations are written, only moving forward in the status list. Empty: unchanged. */
	statusAfterExtraction: string;
	/** Re-extract when a PDF in the attachments folder changes (saved in Obsidian's viewer or PDF++). */
	extractOnPdfSave: boolean;
	/** Desktop only. Run on a PDF before extraction; {in} and {out} are replaced by file paths. */
	preExtractionCommand: string;

	// Reading round trip (desktop only)
	/** Absolute folder a reading app syncs with. Empty: round trip off. */
	tabletFolder: string;
	/** Status that sends the PDF to the tablet folder. Empty: only the command sends. */
	sendStatus: string;
	/** Status set when a PDF comes back with changes. Empty: unchanged. */
	returnStatus: string;
	/** Also bring back PDFs in the tablet folder that Stacks didn't send, matched by attachment filename. */
	tabletAdoptUnknown: boolean;
	/** What was sent to the tablet folder, by file name there. Kept by the plugin, not shown. */
	tabletSent: Record<string, SentRecord>;
}

export const DEFAULT_SETTINGS: LibrarySettings = {
	referencesFolder: "References",
	attachmentsFolder: "References/attachments",
	inboxFolder: "Inbox",
	filenameFormat: "{{citekey}}",
	attachmentFilenameFormat: "{{citekey}}",
	citekeyPattern: "auth.lower + shorttitle(3, 3) + year",
	templatePath: "",
	libraryBase: "",
	authorsAsLinks: true,
	statuses: ["queued", "reading", "reviewing", "processed", "shelved"],
	defaultStatus: "queued",
	clipStatus: "shelved",
	processInboxAutomatically: true,
	completeOnPropertyEdit: true,
	urlProperties: ["url", "source"],
	crossrefMailto: "",
	propertyNames: { ...DEFAULT_PROPERTY_NAMES },
	exportPath: "library.json",
	exportFormat: "csl-json",
	exportFilter: "",
	autoExport: false,
	zoteroImport: { ...DEFAULT_IMPORT_CHOICES },
	lastImportBackup: "",
	annotationsHeading: "## Annotations",
	colorMap: DEFAULT_COLOR_MAP,
	statusAfterExtraction: "",
	extractOnPdfSave: false,
	preExtractionCommand: "",
	tabletFolder: "",
	sendStatus: "reading",
	returnStatus: "reviewing",
	tabletAdoptUnknown: false,
	tabletSent: {},
};

/** Merge saved data over defaults, including the nested property map. */
export function withDefaults(saved: Partial<LibrarySettings> | null | undefined): LibrarySettings {
	const s = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
	s.propertyNames = Object.assign({}, DEFAULT_SETTINGS.propertyNames, saved?.propertyNames ?? {});
	// Guard against hand-edited or corrupted data.json.
	if (!Array.isArray(s.statuses)) s.statuses = [...DEFAULT_SETTINGS.statuses];
	if (!Array.isArray(s.urlProperties)) s.urlProperties = [...DEFAULT_SETTINGS.urlProperties];
	if (!(s.exportFormat in FORMAT_LABELS)) s.exportFormat = DEFAULT_SETTINGS.exportFormat;
	s.zoteroImport = { ...DEFAULT_IMPORT_CHOICES, ...(saved?.zoteroImport ?? {}) };
	s.zoteroImport.collections = { ...(s.zoteroImport.collections ?? {}) };
	if (typeof s.libraryBase !== "string") s.libraryBase = "";
	for (const k of ["annotationsHeading", "colorMap", "statusAfterExtraction", "preExtractionCommand", "tabletFolder", "sendStatus", "returnStatus"] as const)
		if (typeof s[k] !== "string") s[k] = DEFAULT_SETTINGS[k];
	const sent = s.tabletSent as unknown;
	s.tabletSent = sent && typeof sent === "object" && !Array.isArray(sent) ? { ...(sent as Record<string, SentRecord>) } : {};
	// An empty references folder would make every note in the vault a "reference" that
	// automatic completion could rename and move.
	if (typeof s.referencesFolder !== "string" || !s.referencesFolder.trim() || s.referencesFolder.trim() === "/")
		s.referencesFolder = DEFAULT_SETTINGS.referencesFolder;
	return s;
}

const csv = (v: string) =>
	v
		.split(",")
		.map((x) => x.trim())
		.filter(Boolean);

/** What the settings tab learned from the chosen base. */
interface BaseReading {
	config?: BaseConfig;
	error?: string;
	/** Property names, base-declared first, then ones found on notes in the base's folder. */
	properties: string[];
	/** Display names the base gives properties, used to recover a starter base's mapping. */
	displayNames: Record<string, string>;
}


export class LibrarySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: LibraryPlugin) {
		super(app, plugin);
	}

	private baseFile(path: string): TFile | null {
		if (!path.trim()) return null;
		const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
		return f instanceof TFile && f.extension === "base" ? f : null;
	}

	/** Incremented by every base selection; a read that finishes after a newer one is discarded. */
	private baseRequest = 0;

	/** Read the base and collect the properties it and the notes in its folder use. */
	async readBase(path: string): Promise<BaseReading> {
		const none = { properties: [], displayNames: {} };
		const file = this.baseFile(path);
		if (!file) return { ...none, error: path.trim() ? `No base at ${path}.` : undefined };
		let parsed: unknown;
		try {
			parsed = parseYaml(await this.app.vault.read(file));
		} catch (e) {
			return { ...none, error: `Couldn't read ${file.path}: ${e instanceof Error ? e.message : String(e)}` };
		}
		const invalid = validateBase(parsed);
		if (invalid) return { ...none, error: `Couldn't use ${file.path}: ${invalid}.` };
		const config = parsed as BaseConfig;
		const names = basePropertyNames(config);
		const folder = baseFolder(config);
		const counts = new Map<string, number>();
		// Properties on notes the base covers (its required folder), to offer alongside its own.
		if (folder) {
			for (const f of this.app.vault.getMarkdownFiles()) {
				if (!f.path.startsWith(folder + "/")) continue;
				const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
				for (const k of Object.keys(fm)) if (k !== "position") counts.set(k, (counts.get(k) ?? 0) + 1);
			}
		}
		const fromNotes = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).filter((k) => !names.includes(k));
		return { config, properties: [...names, ...fromNotes], displayNames: baseDisplayNames(config) };
	}

	/**
	 * Adopt a base. The folder it requires (if exactly one) becomes the references folder, and
	 * fields are re-matched to its properties, unless keepMappings (a base just generated from
	 * the current mapping). Nothing changes if the base can't be read or offers nothing to match.
	 */
	private async useBase(path: string, keepMappings = false): Promise<void> {
		const s = this.plugin.settings;
		const request = ++this.baseRequest;
		const reading = await this.readBase(path);
		if (request !== this.baseRequest) return; // superseded by a newer selection
		s.libraryBase = path;
		const folder = reading.config ? baseFolder(reading.config) : null;
		if (folder) {
			const from = normalizePath(s.referencesFolder);
			s.referencesFolder = folder;
			// An attachments folder inside the old references folder moves with it
			// (References/attachments -> <base folder>/attachments); one elsewhere is kept.
			const att = normalizePath(s.attachmentsFolder);
			if (from !== folder && (att === from || att.startsWith(from + "/"))) s.attachmentsFolder = folder + att.slice(from.length);
		}
		if (reading.config && !keepMappings && reading.properties.length) {
			s.propertyNames = matchProperties(reading.properties, reading.displayNames);
		}
		await this.plugin.saveSettings();
		this.display();
	}

	private async createBase(): Promise<void> {
		const s = this.plugin.settings;
		let path = "Library.base";
		for (let i = 1; this.app.vault.getAbstractFileByPath(path); i++) path = `Library ${i}.base`;
		await this.app.vault.create(path, stringifyYaml(starterBase(s.referencesFolder, s.propertyNames, s.statuses)));
		await this.useBase(path, true);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		containerEl.empty();

		const text = (name: string, desc: string, get: () => string, set: (v: string) => void, placeholder = "") =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t
						.setPlaceholder(placeholder)
						.setValue(get())
						.onChange(async (v) => {
							set(v.trim());
							await save();
						})
				);
		/** A text setting with vault-path type-ahead. */
		const path = (name: string, desc: string, paths: () => string[], get: () => string, set: (v: string) => void, placeholder = "") =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addSearch((t) => {
					new PathSuggest(this.app, t.inputEl, paths);
					t.setPlaceholder(placeholder)
						.setValue(get())
						.onChange(async (v) => {
							set(v.trim());
							await save();
						});
				});
		const folders = () => folderPaths(this.app);
		const toggle = (name: string, desc: string, get: () => boolean, set: (v: boolean) => void) =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addToggle((t) =>
					t.setValue(get()).onChange(async (v) => {
						set(v);
						await save();
					})
				);

		new Setting(containerEl).setName("Folders").setHeading();
		path("References folder", "Where reference notes live. Cannot be the vault root.", folders, () => s.referencesFolder, (v) => (s.referencesFolder = v && v !== "/" ? v : DEFAULT_SETTINGS.referencesFolder), "References");
		path("Attachments folder", "Where PDFs and other files are filed.", folders, () => s.attachmentsFolder, (v) => (s.attachmentsFolder = v), "References/attachments");
		path("Inbox folder", "Drop zone for Web Clipper notes and PDFs.", folders, () => s.inboxFolder, (v) => (s.inboxFolder = v), "Inbox");

		new Setting(containerEl).setName("Naming").setHeading();
		new Setting(containerEl)
			.setName("Citekey pattern")
			.setDesc("Better BibTeX-style formula. Terms: auth, authors(n), shorttitle(n, m), veryshorttitle, title, year, \"literal\"; modifiers .lower and .upper.")
			.addText((t) =>
				t.setValue(s.citekeyPattern).onChange(async (v) => {
					try {
						parsePattern(v);
						t.inputEl.removeClass("stacks-invalid");
						s.citekeyPattern = v.trim();
						await save();
					} catch {
						t.inputEl.addClass("stacks-invalid");
					}
				})
			);
		text("Note filename format", "Tokens: {{citekey}}, {{title}}, {{year}}, {{author}}.", () => s.filenameFormat, (v) => (s.filenameFormat = v || "{{citekey}}"));
		text("Attachment filename format", "Same tokens. The file extension is kept.", () => s.attachmentFilenameFormat, (v) => (s.attachmentFilenameFormat = v || "{{citekey}}"));

		new Setting(containerEl).setName("Notes").setHeading();
		path("Note template", "Optional template file for the note body. Leave empty for the built-in template.", () => filePaths(this.app, ["md"]), () => s.templatePath, (v) => (s.templatePath = v), "Templates/Reference.md");
		toggle("Authors as links", "Write authors as [[Name]] so they connect to people notes.", () => s.authorsAsLinks, (v) => (s.authorsAsLinks = v));
		text("Statuses", "Comma-separated, in reading order.", () => s.statuses.join(", "), (v) => (s.statuses = csv(v)));
		text("Default status", "Set on items added by ISBN, DOI or URL.", () => s.defaultStatus, (v) => (s.defaultStatus = v));
		text("Status for web clips", "Set on notes processed from the inbox.", () => s.clipStatus, (v) => (s.clipStatus = v));

		new Setting(containerEl).setName("Automation").setHeading();
		toggle("Process inbox automatically", "Handle new notes and PDFs in the inbox folder as they arrive.", () => s.processInboxAutomatically, (v) => (s.processInboxAutomatically = v));
		toggle(
			"Complete notes on property edit",
			"When a note in the references folder gets an ISBN, DOI or URL and has no citekey, look it up, fill it in and rename it.",
			() => s.completeOnPropertyEdit,
			(v) => (s.completeOnPropertyEdit = v)
		);
		text("URL properties in clipped notes", "Comma-separated property names to read the URL from.", () => s.urlProperties.join(", "), (v) => (s.urlProperties = csv(v)));

		new Setting(containerEl).setName("Lookups").setHeading();
		text(
			"Crossref contact email",
			"Optional. Sent to Crossref as mailto for their polite pool. Nothing is sent when empty.",
			() => s.crossrefMailto,
			(v) => (s.crossrefMailto = v)
		);

		new Setting(containerEl).setName("Bibliography").setHeading();
		new Setting(containerEl)
			.setName("Format")
			.setDesc("CSL-JSON works with Pandoc, Quarto and the Pandoc Reference List plugin. See docs/citation-fields.md for what each format keeps.")
			.addDropdown((d) => {
				for (const [k, label] of Object.entries(FORMAT_LABELS)) d.addOption(k, label);
				d.setValue(s.exportFormat).onChange(async (v) => {
					const old = FORMAT_EXTENSIONS[s.exportFormat];
					s.exportFormat = v as BibFormat;
					// Follow the format with the file's extension, if it still has the old one.
					if (s.exportPath.endsWith(`.${old}`)) s.exportPath = s.exportPath.slice(0, -old.length) + FORMAT_EXTENSIONS[s.exportFormat];
					await save();
					this.display();
				});
			});
		path("Bibliography file", "Relative to the vault root. Written with entries sorted by citekey, so git diffs stay small.", () => filePaths(this.app, ["json", "bib"]), () => s.exportPath, (v) => (s.exportPath = v), "library.json");
		new Setting(containerEl)
			.setName("Only references where")
			.setDesc('Optional. "property: value, value", for a project bibliography. For example: collections: Climate, or status: processed, reviewing.')
			.addText((t) =>
				t
					.setPlaceholder("collections: Climate")
					.setValue(s.exportFilter)
					.onChange(async (v) => {
						const ok = !v.trim() || !!parseFilter(v);
						t.inputEl.toggleClass("stacks-invalid", !ok);
						if (ok) {
							s.exportFilter = v.trim();
							await save();
						}
					})
			);
		toggle("Export automatically", "Rewrite the bibliography a few seconds after a reference note changes. Unchanged output isn't rewritten.", () => s.autoExport, (v) => {
			s.autoExport = v;
			if (v) this.plugin.scheduleExport();
			else this.plugin.cancelExport();
		});
		new Setting(containerEl).addButton((b) => b.setButtonText("Export now").onClick(() => void this.plugin.exportBibliography(true)));

		this.displayAnnotations(containerEl);
		this.displayBase(containerEl);
	}

	/** Annotation extraction and the reading round trip. */
	private displayAnnotations(containerEl: HTMLElement): void {
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		const text = (name: string, desc: string, get: () => string, set: (v: string) => void, placeholder = "") =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t
						.setPlaceholder(placeholder)
						.setValue(get())
						.onChange(async (v) => {
							set(v.trim());
							await save();
						})
				);

		new Setting(containerEl).setName("Annotations").setHeading();
		text(
			"Annotations heading",
			"Highlights and comments are written under this heading, between markers. Text outside the markers is never changed.",
			() => s.annotationsHeading,
			(v) => (s.annotationsHeading = v),
			"## Annotations"
		);
		const colors = new Setting(containerEl)
			.setName("Highlight colors")
			.setDesc("One line per color: color: callout, Label. Colors: " + "yellow, red, green, blue, orange, purple, magenta, cyan, gray, or #rrggbb. " + "\"default\" covers other colors; \"note\" is used for sticky notes.");
		colors.addTextArea((t) => {
			t.inputEl.rows = 7;
			t.setValue(s.colorMap).onChange(async (v) => {
				const { errors } = parseColorMap(v);
				t.inputEl.toggleClass("stacks-invalid", errors.length > 0);
				t.inputEl.title = errors.length ? `Not understood: ${errors.join("; ")}` : "";
				s.colorMap = v;
				await save();
			});
		});
		text(
			"Status after extraction",
			"Optional. Set after annotations are written, if the note is at an earlier status. Leave empty to keep the status.",
			() => s.statusAfterExtraction,
			(v) => (s.statusAfterExtraction = v),
			"processed"
		);
		new Setting(containerEl)
			.setName("Extract when a PDF is saved")
			.setDesc("Re-extract when a PDF in the attachments folder changes, for example after highlighting in PDF++.")
			.addToggle((t) =>
				t.setValue(s.extractOnPdfSave).onChange(async (v) => {
					s.extractOnPdfSave = v;
					await save();
				})
			);
		// Running commands and reaching folders outside the vault need the desktop app.
		if (!Platform.isDesktopApp) return;
		text(
			"Pre-extraction command (desktop)",
			"Optional. Runs on a PDF before extraction, from the vault folder. {in} is the PDF, {out} the file to write; if {out} is written, it replaces the PDF.",
			() => s.preExtractionCommand,
			(v) => (s.preExtractionCommand = v),
			"python3 scripts/expand_highlights.py {in} {out}"
		);

		new Setting(containerEl).setName("Reading round trip (desktop)").setHeading();
		text(
			"Tablet folder",
			"Absolute path of a folder your reading app syncs with. PDFs are copied there and their annotations brought back. Leave empty to turn this off.",
			() => s.tabletFolder,
			(v) => (s.tabletFolder = v),
			"/Users/me/Dropbox/Apps/Books"
		);
		text("Send on status", "Copy the PDF to the tablet folder when a note's status changes to this. Leave empty to send only with the command.", () => s.sendStatus, (v) => (s.sendStatus = v), "reading");
		text("Status when highlights return", "Set when a PDF comes back changed. Leave empty to keep the status.", () => s.returnStatus, (v) => (s.returnStatus = v), "reviewing");
		new Setting(containerEl)
			.setName("Bring back PDFs Stacks didn't send")
			.setDesc("Also import PDFs already in the tablet folder whose name matches an attachment and which are newer than it.")
			.addToggle((t) =>
				t.setValue(s.tabletAdoptUnknown).onChange(async (v) => {
					s.tabletAdoptUnknown = v;
					await save();
				})
			);
	}

	/** The library base and the field mapping it drives. */
	private displayBase(containerEl: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(containerEl).setName("Library base").setHeading();
		const hasBase = !!this.baseFile(s.libraryBase);
		new Setting(containerEl)
			.setName("Base")
			.setDesc(
				hasBase
					? "The plugin reads this base's folder and properties, and writes notes that show up in it."
					: "Choose the base that shows your library. The plugin reads its folder and properties. No base yet? Create one."
			)
			.addSearch((t) => {
				new PathSuggest(this.app, t.inputEl, () => filePaths(this.app, ["base"]));
				t.setPlaceholder("Library.base")
					.setValue(s.libraryBase)
					.onChange(async (v) => {
						const value = v.trim();
						// Adopt the base once the path names one; until then just remember what's typed.
						if (this.baseFile(value)) await this.useBase(value);
						else {
							this.baseRequest++; // a pending read for an earlier path is now stale
							s.libraryBase = value;
							await this.plugin.saveSettings();
						}
					});
			})
			.addButton((b) =>
				hasBase
					? b.setButtonText("Re-read").setTooltip("Match the fields to the base's properties again").onClick(() => void this.useBase(s.libraryBase))
					: b.setButtonText("Create base").setCta().onClick(() => void this.createBase())
			);

		const fields = containerEl.createDiv();
		void this.displayFields(fields);
	}

	private async displayFields(el: HTMLElement): Promise<void> {
		const s = this.plugin.settings;
		const reading = await this.readBase(s.libraryBase);
		new Setting(el)
			.setName("Fields")
			.setDesc(
				reading.error
					? reading.error
					: reading.config
						? `Which of the base's properties holds each field. Matched automatically; change any that are wrong. A field with no matching property is created under the name shown.`
						: "Which property holds each field. Choose a base above to pick from its properties."
			);
		for (const key of PROPERTY_KEYS) {
			const fallback = DEFAULT_PROPERTY_NAMES[key];
			const current = s.propertyNames[key] || fallback;
			const options = [...new Set([current, ...reading.properties, fallback])];
			new Setting(el).setName(FIELD_LABELS[key]).addDropdown((d) => {
				for (const o of options) d.addOption(o, reading.config && o === fallback && !reading.properties.includes(o) ? `${o} (new)` : o);
				d.setValue(current).onChange(async (v) => {
					s.propertyNames[key] = v || fallback;
					await this.plugin.saveSettings();
				});
			});
		}
	}
}
