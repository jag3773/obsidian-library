import { Notice, Plugin, TAbstractFile, TFile, requestUrl } from "obsidian";
import { detectIdentifier } from "./identifiers";
import { Inbox } from "./inbox";
import { Library } from "./library";
import { Fetcher } from "./metadata/http";
import { lookup } from "./metadata/lookup";
import { LibrarySettingTab, LibrarySettings, withDefaults } from "./settings";
import { AddReferenceModal } from "./ui/AddReferenceModal";

const PREFIX = "Reference Library";
const COMPLETE_DEBOUNCE_MS = 2000;
const INBOX_SETTLE_MS = 750;

export default class ReferenceLibraryPlugin extends Plugin {
	settings!: LibrarySettings;
	library!: Library;
	inbox!: Inbox;
	private fetcher!: Fetcher;
	/** Paths the plugin is currently writing, so its own edits don't retrigger handlers. */
	private busy = new Set<string>();
	private completeTimers = new Map<string, number>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.fetcher = async (url, headers) => {
			const res = await requestUrl({ url, headers, throw: false });
			return { status: res.status, text: res.text };
		};
		this.library = new Library(this.app, () => this.settings);
		this.inbox = new Inbox(this.app, this.library, this.fetcher, () => this.settings);

		this.addSettingTab(new LibrarySettingTab(this.app, this));
		this.addRibbonIcon("library", "Add reference", () => this.openAddReference());

		this.addCommand({ id: "add-reference", name: "Add reference", callback: () => this.openAddReference() });
		this.addCommand({
			id: "complete-current-reference",
			name: "Complete current reference from its ISBN, DOI or URL",
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
				if (!checking) void this.guard(file, async () => new Notice(`${PREFIX}: citekey is now ${await this.library.regenerateCitekey(file)}`));
				return true;
			},
		});

		// Register after the initial index so existing files don't fire "create".
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on("create", (f) => this.onCreate(f)));
			this.registerEvent(
				this.app.metadataCache.on("changed", (file) => {
					if (this.settings.completeOnPropertyEdit) this.scheduleCompletion(file);
				})
			);
		});
	}

	onunload(): void {
		for (const t of this.completeTimers.values()) window.clearTimeout(t);
	}

	async loadSettings(): Promise<void> {
		this.settings = withDefaults(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Run fn while marking the file as busy; reports errors as a notice. */
	private async guard<T>(file: TFile, fn: () => Promise<T>): Promise<T | undefined> {
		if (this.busy.has(file.path)) return undefined;
		const path = file.path;
		this.busy.add(path);
		try {
			return await fn();
		} catch (e) {
			console.error(`[${PREFIX}]`, e);
			new Notice(`${PREFIX}: ${e instanceof Error ? e.message : String(e)}`);
			return undefined;
		} finally {
			// The file may have been renamed. Keep its current path busy until our writes settle,
			// so the metadata "changed" events they cause are ignored.
			this.busy.delete(path);
			const after = file.path;
			this.busy.add(after);
			window.setTimeout(() => this.busy.delete(after), 1500);
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
			const existing = this.library.findExisting(data);
			if (existing) {
				new Notice(`${PREFIX}: already in your library as ${existing.basename}.`);
				await this.app.workspace.getLeaf(false).openFile(existing);
				return;
			}
			const file = await this.library.create(data, this.settings.defaultStatus);
			this.busy.add(file.path);
			window.setTimeout(() => this.busy.delete(file.path), 1500);
			await this.app.workspace.getLeaf(false).openFile(file);
			new Notice(`${PREFIX}: added ${file.basename} (from ${data.source}).`);
		} catch (e) {
			console.error(`[${PREFIX}]`, e);
			new Notice(`${PREFIX}: lookup failed. ${e instanceof Error ? e.message : ""}`);
		} finally {
			pending.hide();
		}
	}

	private onCreate(f: TAbstractFile): void {
		if (!(f instanceof TFile) || !this.settings.processInboxAutomatically || !this.inbox.accepts(f)) return;
		// Give the writer (Web Clipper, Finder copy, sync) a moment to finish.
		window.setTimeout(() => {
			// The file may have been moved or deleted while it settled.
			if (this.app.vault.getAbstractFileByPath(f.path) !== f || !this.inbox.accepts(f)) return;
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
		for (const f of files) if (await this.guard(f, () => this.inbox.process(f))) done++;
		new Notice(`${PREFIX}: processed ${done} of ${files.length} inbox items.`);
	}

	private scheduleCompletion(file: TFile): void {
		if (!this.library.isReference(file) || this.busy.has(file.path)) return;
		const fm = this.library.frontmatter(file);
		if (String(fm[this.library.prop("citekey")] ?? "").trim()) return;
		if (!this.library.identifierOf(file)) return;
		const prev = this.completeTimers.get(file.path);
		if (prev) window.clearTimeout(prev);
		this.completeTimers.set(
			file.path,
			window.setTimeout(() => {
				this.completeTimers.delete(file.path);
				void this.completeFromProperties(file, false);
			}, COMPLETE_DEBOUNCE_MS)
		);
	}

	async completeFromProperties(file: TFile, explicit: boolean): Promise<void> {
		const id = this.library.identifierOf(file);
		if (!id) {
			if (explicit) new Notice(`${PREFIX}: add an ISBN, DOI or URL property first.`);
			return;
		}
		await this.guard(file, async () => {
			const data = await lookup(this.fetcher, id, { crossrefMailto: this.settings.crossrefMailto });
			if (!data) {
				new Notice(`${PREFIX}: nothing found for ${id.value}.`);
				return;
			}
			const dup = this.library.findExisting(data, file);
			if (dup && !explicit) {
				new Notice(`${PREFIX}: ${id.value} is already in your library as ${dup.basename}.`);
				return;
			}
			const moved = await this.library.complete(file, data, this.settings.defaultStatus);
			new Notice(`${PREFIX}: completed ${moved.basename} (from ${data.source}).`);
		});
	}
}
