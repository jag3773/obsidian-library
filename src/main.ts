import { Notice, Plugin, TAbstractFile, TFile, requestUrl } from "obsidian";
import { Identifier, detectIdentifier } from "./identifiers";
import { Inbox } from "./inbox";
import { Cancelled, Library } from "./library";
import { Fetcher } from "./metadata/http";
import { lookup } from "./metadata/lookup";
import { LibrarySettingTab, LibrarySettings, withDefaults } from "./settings";
import { AddReferenceModal } from "./ui/AddReferenceModal";

const PREFIX = "Library";
const COMPLETE_DEBOUNCE_MS = 2000;
const INBOX_SETTLE_MS = 750;
const BUSY_SETTLE_MS = 1500;

const sameId = (a: Identifier | null, b: Identifier | null) => !!a && !!b && a.kind === b.kind && a.value === b.value;

export default class LibraryPlugin extends Plugin {
	settings!: LibrarySettings;
	library!: Library;
	inbox!: Inbox;
	private fetcher!: Fetcher;
	/** False once unloaded; queued and in-flight work checks it before touching the vault. */
	private alive = false;
	/** Paths the plugin is currently writing, so its own edits don't retrigger handlers. */
	private busy = new Set<string>();
	/** Every pending timeout, so unload can cancel them. */
	private timers = new Set<number>();
	/** Pending automatic completions by path, with the identifier they were scheduled for. */
	private completeTimers = new Map<string, { timer: number; id: Identifier }>();

	async onload(): Promise<void> {
		this.alive = true;
		await this.loadSettings();
		this.fetcher = async (url, headers) => {
			const res = await requestUrl({ url, headers, throw: false });
			return { status: res.status, text: res.text };
		};
		this.library = new Library(this.app, () => this.settings, () => this.alive);
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
				if (!checking)
					void this.guard(file, async () => {
						const key = await this.library.exclusive(() => this.library.regenerateCitekey(file));
						new Notice(`${PREFIX}: citekey is now ${key}`);
					});
				return true;
			},
		});

		// Register after the initial index so existing files don't fire "create".
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on("create", (f) => this.onCreate(f)));
			this.registerEvent(this.app.metadataCache.on("changed", (file) => this.scheduleCompletion(file)));
			// A pending completion belongs to the path it was scheduled for.
			this.registerEvent(this.app.vault.on("rename", (_f, oldPath) => this.cancelCompletion(oldPath)));
			this.registerEvent(this.app.vault.on("delete", (f) => this.cancelCompletion(f.path)));
		});
	}

	onunload(): void {
		this.alive = false;
		for (const t of this.timers) window.clearTimeout(t);
		this.timers.clear();
		this.completeTimers.clear();
	}

	async loadSettings(): Promise<void> {
		this.settings = withDefaults(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
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
			if (explicit) new Notice(`${PREFIX}: add an ISBN, DOI or URL property first.`);
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
}
