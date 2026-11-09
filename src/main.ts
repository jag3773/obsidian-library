import { Menu, Notice, Platform, Plugin, TAbstractFile, TFile, normalizePath, requestUrl } from "obsidian";
import { FORMAT_LABELS, render } from "./bibliography";
import { nodeHost } from "./desktop";
import { BibliographyExporter } from "./export";
import { Extractor, describeExtraction } from "./extract";
import { Identifier, detectIdentifier } from "./identifiers";
import { Inbox } from "./inbox";
import { Cancelled, Library } from "./library";
import { Fetcher } from "./metadata/http";
import { lookup } from "./metadata/lookup";
import { Host, RoundTrip, runPreExtraction, toArrayBuffer } from "./roundtrip";
import { LibrarySettingTab, LibrarySettings, withDefaults } from "./settings";
import { AddReferenceModal } from "./ui/AddReferenceModal";
import { ReferenceData } from "./metadata/types";
import { NewReferenceModal } from "./ui/NewReferenceModal";
import { RefreshModal } from "./ui/RefreshModal";
import { ImportModal } from "./ui/ImportModal";
import { ReportModal } from "./ui/ReportModal";
import { ZoteroImporter } from "./zoteroImport";
import { ConflictModal } from "./ui/ConflictModal";
import { asText } from "./text";
import { registerMaintenanceCommands } from "./maintenanceCommands";

const PREFIX = "Stacks";
const COMPLETE_DEBOUNCE_MS = 2000;
const INBOX_SETTLE_MS = 750;
const BUSY_SETTLE_MS = 1500;
const EXPORT_DEBOUNCE_MS = 5000;
const PDF_SAVE_DEBOUNCE_MS = 2000;

const sameId = (a: Identifier | null, b: Identifier | null) => !!a && !!b && a.kind === b.kind && a.value === b.value;

export default class LibraryPlugin extends Plugin {
	settings!: LibrarySettings;
	library!: Library;
	inbox!: Inbox;
	exporter!: BibliographyExporter;
	importer!: ZoteroImporter;
	extractor!: Extractor;
	/** Desktop only; null on mobile. */
	roundTrip: RoundTrip | null = null;
	private host: Host | null = null;
	private fetcher!: Fetcher;
	/** The pending automatic bibliography export, if any. */
	private exportTimer: number | null = null;
	/** False once unloaded; queued and in-flight work checks it before touching the vault. */
	private alive = false;
	/** Paths the plugin is currently writing, so its own edits don't retrigger handlers. */
	private busy = new Set<string>();
	/** Every pending timeout, so unload can cancel them. */
	private timers = new Set<number>();
	/** Pending automatic completions by path, with the identifier they were scheduled for. */
	private completeTimers = new Map<string, { timer: number; id: Identifier }>();
	/** Last seen status of each reference note, to notice a change to the send status. */
	private statuses = new Map<string, string>();
	/** Pending extract-on-save runs by PDF path. */
	private pdfTimers = new Map<string, number>();
	/** Tablet folder the watcher was started for. */
	private watchedFolder = "";
	private layoutReady = false;

	/** File-system access for the round trip and the pre-extraction command. Desktop only. */
	protected createHost(): Host | null {
		return Platform.isDesktopApp ? nodeHost(this.app) : null;
	}

	async onload(): Promise<void> {
		this.alive = true;
		await this.loadSettings();
		this.fetcher = async (url, headers) => {
			const res = await requestUrl({ url, headers, throw: false });
			return { status: res.status, text: res.text };
		};
		this.library = new Library(this.app, () => this.settings, () => this.alive);
		this.inbox = new Inbox(this.app, this.library, this.fetcher, () => this.settings);
		this.exporter = new BibliographyExporter(this.app, this.library, () => this.settings);
		const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		this.importer = new ZoteroImporter(this.app, this.library, () => this.settings, `${pluginDir}/backups`, async (path) => {
			this.settings.lastImportBackup = path;
			await this.saveSettings();
		});
		this.extractor = new Extractor(this.app, this.library, () => this.settings, () => this.alive);
		this.host = this.createHost();
		if (this.host)
			this.roundTrip = new RoundTrip(
				this.app,
				this.library,
				this.extractor,
				() => this.settings,
				() => this.saveSettings(),
				this.host,
				{ notice: (m) => new Notice(m), conflict: (info) => ConflictModal.ask(this.app, info) },
				(path) => this.settle(path),
				() => this.alive
			);

		this.addSettingTab(new LibrarySettingTab(this.app, this));
		this.addRibbonIcon("library", "Add reference", () => this.openAddReference());

		this.addCommand({ id: "add-reference", name: "Add reference", callback: () => this.openAddReference() });
		this.addCommand({
			id: "new-reference",
			name: "New reference without a lookup",
			callback: () => new NewReferenceModal(this.app, (data) => void this.createManualReference(data)).open(),
		});
		this.addCommand({
			id: "refresh-metadata",
			name: "Refresh metadata from ISBN, DOI or URL",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.library.isReference(file) || !this.library.identifierOf(file)) return false;
				if (!checking) void this.refreshMetadata(file);
				return true;
			},
		});
		this.addCommand({
			id: "complete-current-reference",
			name: "Complete current reference",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.completeFromProperties(file, true);
				return true;
			},
		});
		this.addCommand({ id: "process-inbox", name: "Process inbox now", callback: () => this.processWholeInbox() });
		this.addCommand({
			id: "regenerate-citekey",
			name: "Regenerate citekey for current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.library.isReference(file)) return false;
				if (!checking)
					void this.guard(file, async () => {
						const key = await this.library.exclusive(() => this.library.regenerateCitekey(file));
						new Notice(`${PREFIX}: citekey is now ${key}`);
					});
				return true;
			},
		});

		this.addCommand({ id: "import-zotero", name: "Import from Zotero (Better BibTeX JSON)", callback: () => this.openImport() });
		this.addCommand({
			id: "undo-zotero-import",
			name: "Undo last Zotero import",
			checkCallback: (checking) => {
				if (!this.settings.lastImportBackup) return false;
				if (!checking) void this.undoImport();
				return true;
			},
		});
		this.addCommand({ id: "export-bibliography", name: "Export bibliography", callback: () => void this.exportBibliography(true) });
		this.addCommand({
			id: "copy-citation",
			name: "Copy bibliography entry for current reference",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.library.isReference(file)) return false;
				if (!checking) void this.copyBibliography([file]);
				return true;
			},
		});
		// Several references selected in the file explorer.
		this.registerEvent(
			this.app.workspace.on("files-menu", (menu: Menu, files: TAbstractFile[]) => {
				const refs = files.filter((f): f is TFile => f instanceof TFile && this.library.isReference(f));
				if (!refs.length) return;
				menu.addItem((item) =>
					item
						.setTitle(`Copy bibliography (${FORMAT_LABELS[this.settings.exportFormat]})`)
						.setIcon("library")
						.onClick(() => void this.copyBibliography(refs))
				);
			})
		);
		this.addCommand({
			id: "extract-annotations",
			name: "Extract annotations for current note",
			checkCallback: (checking) => {
				const note = this.activeReference();
				if (!note) return false;
				if (!checking) void this.extractNow(note);
				return true;
			},
		});
		this.addCommand({
			id: "send-to-tablet",
			name: "Send PDF to tablet folder",
			checkCallback: (checking) => {
				const note = this.activeReference();
				if (!note || !this.roundTrip?.folder()) return false;
				if (!checking) void this.sendToTablet(note, true);
				return true;
			},
		});
		this.addCommand({
			id: "check-tablet-folder",
			name: "Check tablet folder for returned PDFs",
			checkCallback: (checking) => {
				if (!this.roundTrip?.folder()) return false;
				if (!checking) this.roundTrip.checkAll(true).catch((e) => this.report(e));
				return true;
			},
		});

		// Health check, PDF relinking and duplicate merging (#26, #28).
		registerMaintenanceCommands(this);

		// Register after the initial index so existing files don't fire "create".
		this.app.workspace.onLayoutReady(() => {
			for (const f of this.library.referenceFiles()) this.statuses.set(f.path, this.statusOf(f));
			this.registerEvent(this.app.vault.on("create", (f) => this.onCreate(f)));
			this.registerEvent(
				this.app.metadataCache.on("changed", (file) => {
					this.scheduleCompletion(file);
					if (this.library.isReference(file)) this.scheduleExport();
					this.onStatusChange(file);
				})
			);
			this.registerEvent(this.app.vault.on("modify", (f) => this.onPdfModified(f)));
			// A pending completion belongs to the path it was scheduled for.
			this.registerEvent(
				this.app.vault.on("rename", (f, oldPath) => {
					this.cancelCompletion(oldPath);
					// Into, within or out of the references folder.
					const folder = normalizePath(this.settings.referencesFolder);
					if (f instanceof TFile && f.extension === "md" && (this.library.isReference(f) || oldPath.startsWith(`${folder}/`))) this.scheduleExport();
					const st = this.statuses.get(oldPath);
					this.statuses.delete(oldPath);
					if (st !== undefined) this.statuses.set(f.path, st);
					if (f instanceof TFile) void this.roundTrip?.onVaultRename(f, oldPath);
				})
			);
			this.registerEvent(
				this.app.vault.on("delete", (f) => {
					this.cancelCompletion(f.path);
					if (f instanceof TFile && f.extension === "md" && this.library.inFolder(f, this.settings.referencesFolder)) this.scheduleExport();
					this.statuses.delete(f.path);
				})
			);
			this.layoutReady = true;
			this.startRoundTrip();
		});
	}

	/** Scan the tablet folder and watch it, when one is set. Called again when the setting changes. */
	private startRoundTrip(): void {
		const rt = this.roundTrip;
		if (!rt) return;
		const folder = rt.folder() ?? "";
		if (folder === this.watchedFolder) return;
		this.watchedFolder = folder;
		rt.stop();
		if (!folder) return;
		rt.startWatching();
		rt.checkAll().catch((e) => {
			if (!(e instanceof Cancelled)) new Notice(`${PREFIX}: tablet folder: ${e instanceof Error ? e.message : String(e)}`);
		});
	}

	onunload(): void {
		this.alive = false;
		this.exportTimer = null;
		this.roundTrip?.stop();
		this.pdfTimers.clear();
		for (const t of this.timers) window.clearTimeout(t);
		this.timers.clear();
		this.completeTimers.clear();
	}

	async loadSettings(): Promise<void> {
		this.settings = withDefaults((await this.loadData()) as Partial<LibrarySettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Follow a changed tablet folder once the layout (and so the round trip) has started.
		if (this.alive && this.layoutReady) this.startRoundTrip();
	}

	/** setTimeout that unload cancels, and that never runs after unload. */
	private later(fn: () => void, ms: number): number {
		const t = window.setTimeout(() => {
			this.timers.delete(t);
			if (this.alive) fn();
		}, ms);
		this.timers.add(t);
		return t;
	}

	private clearLater(t: number): void {
		window.clearTimeout(t);
		this.timers.delete(t);
	}

	private report(e: unknown): void {
		if (e instanceof Cancelled) return;
		console.error(`[${PREFIX}]`, e);
		new Notice(`${PREFIX}: ${e instanceof Error ? e.message : String(e)}`);
	}

	/** Keep a path marked busy briefly, so metadata events caused by our own writes are ignored. */
	private settle(path: string): void {
		this.busy.add(path);
		this.later(() => this.busy.delete(path), BUSY_SETTLE_MS);
	}

	/** Run fn while marking the file as busy; reports errors as a notice. */
	private async guard<T>(file: TFile, fn: () => Promise<T>): Promise<T | undefined> {
		if (!this.alive || this.busy.has(file.path)) return undefined;
		const path = file.path;
		this.busy.add(path);
		try {
			return await fn();
		} catch (e) {
			this.report(e);
			return undefined;
		} finally {
			// The file may have been renamed. Keep its current path busy until our writes settle.
			this.busy.delete(path);
			this.settle(file.path);
		}
	}

	private openAddReference(): void {
		new AddReferenceModal(this.app, (value) => void this.addByIdentifier(value)).open();
	}

	async addByIdentifier(input: string): Promise<void> {
		const id = detectIdentifier(input);
		if (!id) {
			new Notice(`${PREFIX}: "${input}" doesn't look like an ISBN, DOI, arXiv ID or URL.`);
			return;
		}
		const pending = new Notice(`${PREFIX}: looking up ${id.kind.toUpperCase()} ${id.value}…`, 0);
		try {
			const data = await lookup(this.fetcher, id, { crossrefMailto: this.settings.crossrefMailto });
			if (!data) {
				new Notice(`${PREFIX}: nothing found for ${id.value}.`);
				return;
			}
			// Duplicate check and creation happen together, so overlapping captures can't both create.
			const { file, existing } = await this.library.exclusive(async () => {
				const found = this.library.findExisting(data);
				if (found) return { file: found, existing: true };
				const created = await this.library.create(data, this.settings.defaultStatus);
				this.settle(created.path);
				return { file: created, existing: false };
			});
			await this.app.workspace.getLeaf(false).openFile(file);
			new Notice(existing ? `${PREFIX}: already in your library as ${file.basename}.` : `${PREFIX}: added ${file.basename} (from ${data.source}).`);
		} catch (e) {
			if (!(e instanceof Cancelled)) {
				console.error(`[${PREFIX}]`, e);
				new Notice(`${PREFIX}: lookup failed. ${e instanceof Error ? e.message : ""}`);
			}
		} finally {
			pending.hide();
		}
	}

	private onCreate(f: TAbstractFile): void {
		if (!(f instanceof TFile) || !this.settings.processInboxAutomatically || !this.inbox.accepts(f)) return;
		// Give the writer (Web Clipper, Finder copy, sync) a moment to finish.
		this.later(() => {
			// The file may have been moved or deleted while it settled.
			if (!this.library.exists(f) || !this.inbox.accepts(f)) return;
			void this.guard(f, () => this.inbox.process(f));
		}, INBOX_SETTLE_MS);
	}

	private async processWholeInbox(): Promise<void> {
		const files = this.app.vault.getFiles().filter((f) => this.inbox.accepts(f));
		if (!files.length) {
			new Notice(`${PREFIX}: inbox is empty.`);
			return;
		}
		let done = 0;
		for (const f of files) {
			if (!this.alive) return;
			if (await this.guard(f, () => this.inbox.process(f))) done++;
		}
		new Notice(`${PREFIX}: processed ${done} of ${files.length} inbox items.`);
	}

	private cancelCompletion(path: string): void {
		const pending = this.completeTimers.get(path);
		if (!pending) return;
		this.clearLater(pending.timer);
		this.completeTimers.delete(path);
	}

	/**
	 * Whether automatic completion may still act on the file for the identifier it was
	 * scheduled with: plugin loaded, option on, file still in the vault and in the references
	 * folder, no citekey yet, and the same identifier.
	 */
	private autoEligible(file: TFile, id: Identifier | null): boolean {
		return (
			this.alive &&
			this.settings.completeOnPropertyEdit &&
			this.library.exists(file) &&
			this.library.isReference(file) &&
			!this.library.citekeyOf(file) &&
			sameId(this.library.identifierOf(file), id)
		);
	}

	private scheduleCompletion(file: TFile): void {
		if (this.busy.has(file.path)) return;
		// Debounce: every change restarts the timer, and a change that makes the note
		// ineligible (citekey added, identifier removed, option off) just cancels it.
		this.cancelCompletion(file.path);
		const id = this.library.identifierOf(file);
		if (!this.autoEligible(file, id)) return;
		const path = file.path;
		const timer = this.later(() => {
			this.completeTimers.delete(path);
			if (file.path !== path) return;
			void this.completeFromProperties(file, false, id as Identifier);
		}, COMPLETE_DEBOUNCE_MS);
		this.completeTimers.set(path, { timer, id: id as Identifier });
	}

	/**
	 * Look up the note's identifier and fill it in. `explicit` is the command; otherwise this is
	 * automatic completion, which revalidates eligibility before the request and again before
	 * writing, since the note may have moved, gained a citekey or changed meanwhile.
	 */
	async completeFromProperties(file: TFile, explicit: boolean, scheduled?: Identifier): Promise<void> {
		const id = this.library.identifierOf(file);
		if (!id) {
			// No identifier: name it from its own properties, with no network request (#16).
			if (explicit) await this.completeLocally(file);
			return;
		}
		if (!explicit && !this.autoEligible(file, scheduled ?? id)) return;
		await this.guard(file, async () => {
			const data = await lookup(this.fetcher, id, { crossrefMailto: this.settings.crossrefMailto });
			if (!data) {
				new Notice(`${PREFIX}: nothing found for ${id.value}.`);
				return;
			}
			await this.library.exclusive(async () => {
				if (!this.library.exists(file)) return;
				if (explicit ? !sameId(this.library.identifierOf(file), id) : !this.autoEligible(file, id)) return;
				const dup = this.library.findExisting(data, file);
				if (dup && !explicit) {
					new Notice(`${PREFIX}: ${id.value} is already in your library as ${dup.basename}.`);
					return;
				}
				const moved = await this.library.complete(file, data, this.settings.defaultStatus);
				new Notice(`${PREFIX}: completed ${moved.basename} (from ${data.source}).`);
			});
		});
	}

	/** Export soon, once edits settle; each change restarts the wait. Only when auto-export is on. */
	scheduleExport(): void {
		if (!this.alive || !this.settings.autoExport) return;
		if (this.exportTimer !== null) this.clearLater(this.exportTimer);
		this.exportTimer = this.later(() => {
			this.exportTimer = null;
			// The setting may have been turned off while this waited.
			if (this.settings.autoExport) void this.exportBibliography(false);
		}, EXPORT_DEBOUNCE_MS);
	}

	/** Drop a pending automatic export (auto-export turned off). */
	cancelExport(): void {
		if (this.exportTimer !== null) this.clearLater(this.exportTimer);
		this.exportTimer = null;
	}

	/**
	 * Write the bibliography. `explicit` (the command or button) reports the result; automatic
	 * exports stay quiet unless they fail.
	 */
	async exportBibliography(explicit: boolean): Promise<void> {
		try {
			const r = await this.exporter.export();
			if (!explicit) {
				if (r.problems.length) console.debug(`[${PREFIX}] bibliography: ${r.problems.length} problems`, r.problems);
				return;
			}
			const summary = [
				`${r.items.length} references ${r.written ? "written to" : "already up to date in"} ${r.path} (${FORMAT_LABELS[r.format]}).`,
				...(r.filtered ? [`${r.filtered} notes left out by the filter "${this.settings.exportFilter}".`] : []),
			];
			if (!r.problems.length) {
				new Notice(`${PREFIX}: ${summary.join(" ")}`);
				return;
			}
			const lines = r.problems.map((p) => `${p.citekey ?? p.path}: ${p.problem}`);
			new ReportModal(this.app, "Bibliography exported", summary, [{ heading: "To check", lines }]).open();
		} catch (e) {
			this.report(e);
		}
	}

	/** Copy the given references' entries to the clipboard in the configured format. */
	async copyBibliography(files: TFile[]): Promise<void> {
		const bib = this.exporter.build(files, "");
		if (!bib.items.length) {
			new Notice(`${PREFIX}: nothing to copy. ${bib.problems.map((p) => p.problem).join("; ")}`);
			return;
		}
		await navigator.clipboard.writeText(render(bib.items, this.settings.exportFormat));
		new Notice(`${PREFIX}: copied ${bib.items.length} ${bib.items.length === 1 ? "entry" : "entries"} (${FORMAT_LABELS[this.settings.exportFormat]}).`);
	}

	/** Create a manual reference (no lookup), unless its identifier is already in the library. */
	async createManualReference(data: ReferenceData): Promise<TFile | undefined> {
		try {
			const { file, existing } = await this.library.exclusive(async () => {
				const found = this.library.findExisting(data);
				if (found) return { file: found, existing: true };
				const created = await this.library.create(data, this.settings.defaultStatus);
				this.settle(created.path);
				return { file: created, existing: false };
			});
			await this.app.workspace.getLeaf(false).openFile(file);
			new Notice(existing ? `${PREFIX}: already in your library as ${file.basename}.` : `${PREFIX}: created ${file.basename}.`);
			return file;
		} catch (e) {
			this.report(e);
			return undefined;
		}
	}

	/** Give a note without an identifier a citekey and its filename from its own properties. */
	private async completeLocally(file: TFile): Promise<void> {
		if (!this.library.isReference(file)) {
			new Notice(`${PREFIX}: move the note into ${this.settings.referencesFolder} first, or add an ISBN, DOI or URL.`);
			return;
		}
		const title = asText(this.library.frontmatter(file)[this.library.prop("title")]).trim();
		if (!title) {
			new Notice(`${PREFIX}: add a title (and ideally authors and a year) first.`);
			return;
		}
		await this.guard(file, async () => {
			const moved = await this.library.exclusive(() => this.library.complete(file, null, this.settings.defaultStatus));
			new Notice(`${PREFIX}: ${moved.basename} is ready, without a lookup.`);
		});
	}

	/** Look the note's identifier up again and offer each changed field for review. */
	async refreshMetadata(file: TFile): Promise<void> {
		const id = this.library.identifierOf(file);
		if (!id) return;
		const pending = new Notice(`${PREFIX}: looking up ${id.value}…`, 0);
		try {
			const data = await lookup(this.fetcher, id, { crossrefMailto: this.settings.crossrefMailto });
			if (!data) {
				new Notice(`${PREFIX}: nothing found for ${id.value}.`);
				return;
			}
			const changes = this.library.refreshChanges(file, data);
			if (!changes.length) {
				new Notice(`${PREFIX}: ${file.basename} already matches ${data.source}.`);
				return;
			}
			new RefreshModal(this.app, file.basename, data.source, changes, (chosen) =>
				void this.guard(file, async () => {
					await this.library.exclusive(() => this.library.applyChanges(file, chosen));
					if (chosen.length) new Notice(`${PREFIX}: updated ${chosen.length} ${chosen.length === 1 ? "field" : "fields"} on ${file.basename}.`);
				})
			).open();
		} catch (e) {
			this.report(e);
		} finally {
			pending.hide();
		}
	}

	private openImport(): void {
		new ImportModal(
			this.app,
			this.importer,
			this.settings.zoteroImport,
			this.settings.statuses,
			() => this.saveSettings(),
			(reportPath) => {
				const report = this.app.vault.getAbstractFileByPath(reportPath);
				if (report instanceof TFile) void this.app.workspace.getLeaf(false).openFile(report);
				new Notice(`${PREFIX}: import done. The report is ${reportPath}.`);
			}
		).open();
	}

	/** Reverse the last import from its backup. */
	async undoImport(): Promise<void> {
		const path = this.settings.lastImportBackup;
		if (!path) return;
		try {
			const r = await this.importer.undo(path);
			this.settings.lastImportBackup = "";
			await this.saveSettings();
			new Notice(
				`${PREFIX}: restored ${r.restored} notes, moved ${r.trashed} created notes to the trash.${r.skipped.length ? ` Skipped (changed or missing): ${r.skipped.join(", ")}` : ""}`
			);
		} catch (e) {
			this.report(e);
		}
	}
	/** The active reference note, or the reference note of the active PDF. */
	private activeReference(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		if (!file) return null;
		if (this.library.isReference(file)) return file;
		if (file.extension === "pdf") return this.extractor.notesFor(file)[0] ?? null;
		return null;
	}

	private statusOf(file: TFile): string {
		return asText(this.library.frontmatter(file)[this.library.prop("status")]).trim();
	}

	/** Send the PDF when a note's status changes to the send status. */
	private onStatusChange(file: TFile): void {
		if (!this.library.isReference(file)) return;
		const status = this.statusOf(file);
		const prev = this.statuses.get(file.path);
		this.statuses.set(file.path, status);
		const send = this.settings.sendStatus.trim();
		if (!send || status !== send || prev === send || !this.roundTrip?.folder()) return;
		void this.sendToTablet(file, false);
	}

	async sendToTablet(note: TFile, explicit: boolean): Promise<void> {
		if (!this.roundTrip) return;
		try {
			const message = await this.roundTrip.send(note);
			new Notice(`${PREFIX}: ${message}`);
		} catch (e) {
			if (e instanceof Cancelled) return;
			new Notice(`${PREFIX}: couldn't send ${note.basename}: ${e instanceof Error ? e.message : String(e)}`);
			if (explicit) console.warn(`[${PREFIX}]`, e);
		}
	}

	/** The command: optional pre-extraction command (desktop), then extraction. */
	async extractNow(note: TFile): Promise<void> {
		await this.guard(note, async () => {
			const pdf = this.extractor.pdfFor(note);
			if (!pdf) throw new Error(`${note.basename} has no PDF linked in its ${this.library.prop("pdf")} property.`);
			const pending = new Notice(`${PREFIX}: extracting annotations from ${pdf.name}…`, 0);
			try {
				let bytes: ArrayBuffer | undefined;
				const command = this.settings.preExtractionCommand.trim();
				if (command && this.host) {
					try {
						const before = new Uint8Array(await this.app.vault.readBinary(pdf));
						const after = await runPreExtraction(this.host, command, before, pdf.name);
						if (after && !sameBytes(before, after)) {
							// The command can run for minutes; stop if unloaded, and don't overwrite a PDF that changed meanwhile.
							if (!this.alive) throw new Cancelled();
							if (!sameBytes(before, new Uint8Array(await this.app.vault.readBinary(pdf))))
								throw new Error(`${pdf.name} changed while the pre-extraction command ran`);
							bytes = toArrayBuffer(after);
							this.settle(pdf.path);
							await this.app.vault.modifyBinary(pdf, bytes);
						}
					} catch (e) {
						if (e instanceof Cancelled) throw e;
						new Notice(`${PREFIX}: ${e instanceof Error ? e.message : String(e)}. Extracting from the PDF as it is.`);
					}
				}
				const result = await this.extractor.extract(note, bytes);
				new Notice(`${PREFIX}: ${describeExtraction(result)}`);
			} finally {
				pending.hide();
			}
		});
	}

	/** Extract on save: a PDF in the attachments folder changed outside Stacks. */
	private onPdfModified(f: TAbstractFile): void {
		if (!(f instanceof TFile) || f.extension !== "pdf" || !this.settings.extractOnPdfSave) return;
		if (this.busy.has(f.path) || !this.library.inFolder(f, this.settings.attachmentsFolder)) return;
		const pending = this.pdfTimers.get(f.path);
		if (pending !== undefined) this.clearLater(pending);
		const path = f.path;
		this.pdfTimers.set(
			path,
			this.later(() => {
				this.pdfTimers.delete(path);
				if (!this.library.exists(f) || this.busy.has(f.path)) return;
				for (const note of this.extractor.notesFor(f)) {
					void this.guard(note, async () => {
						const r = await this.extractor.extract(note);
						if (r.changed) new Notice(`${PREFIX}: ${describeExtraction(r)}`);
					});
				}
			}, PDF_SAVE_DEBOUNCE_MS)
		);
	}
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
