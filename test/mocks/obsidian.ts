// A small in-memory stand-in for the parts of the Obsidian API the plugin uses, so vault-level
// behaviour (Library, Inbox, the plugin's timers) can be tested under node:test.
// Frontmatter is stored as JSON (valid YAML). The metadata cache updates on a later macrotask,
// like Obsidian's, so tests see the same "written but not yet indexed" window.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { parse as parseYamlText, stringify as stringifyYamlText } from "yaml";
(globalThis as any).window ??= globalThis;

type Handler = (...args: any[]) => void;
class Events {
	private handlers = new Map<string, Set<Handler>>();
	on(name: string, cb: Handler) {
		if (!this.handlers.has(name)) this.handlers.set(name, new Set());
		this.handlers.get(name)!.add(cb);
		return { name, cb, owner: this };
	}
	offref(ref: { name: string; cb: Handler }) {
		this.handlers.get(ref.name)?.delete(ref.cb);
	}
	trigger(name: string, ...args: any[]) {
		for (const cb of [...(this.handlers.get(name) ?? [])]) cb(...args);
	}
}

export function normalizePath(p: string): string {
	const s = p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
	return s || "/";
}

export class TAbstractFile {
	path = "";
	name = "";
	parent: TFolder | null = null;
	vault!: Vault;
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	isRoot() {
		return this.path === "/";
	}
}

export class TFile extends TAbstractFile {
	basename = "";
	extension = "";
	stat = { ctime: 0, mtime: 0, size: 0 };
}

function setPath(f: TAbstractFile, path: string) {
	f.path = path;
	f.name = path.split("/").pop() ?? path;
	if (f instanceof TFile) {
		const dot = f.name.lastIndexOf(".");
		f.basename = dot > 0 ? f.name.slice(0, dot) : f.name;
		f.extension = dot > 0 ? f.name.slice(dot + 1) : "";
	}
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

export function getFrontMatterInfo(content: string) {
	const m = content.match(FM_RE);
	return { exists: !!m, frontmatter: m ? m[1] : "", contentStart: m ? m[0].length : 0 };
}

export function stringifyYaml(obj: unknown): string {
	return stringifyYamlText(obj);
}

export function parseYaml(text: string): any {
	return text.trim() ? parseYamlText(text) : null;
}

function splitContent(content: string): { fm: Record<string, unknown> | null; body: string } {
	const info = getFrontMatterInfo(content);
	return info.exists ? { fm: parseYaml(info.frontmatter) ?? {}, body: content.slice(info.contentStart) } : { fm: null, body: content };
}

function joinContent(fm: Record<string, unknown> | null, body: string): string {
	return fm && Object.keys(fm).length ? `---\n${JSON.stringify(fm)}\n---\n${body}` : body;
}

export class Vault extends Events {
	files = new Map<string, TAbstractFile>();
	contents = new Map<TFile, string | ArrayBuffer>();
	root: TFolder;
	constructor(private app: App) {
		super();
		this.root = new TFolder();
		this.root.path = "/";
		this.files.set("/", this.root);
	}
	getAbstractFileByPath(path: string): TAbstractFile | null {
		return this.files.get(normalizePath(path)) ?? null;
	}
	getAllLoadedFiles(): TAbstractFile[] {
		return [...this.files.values()];
	}
	getFiles(): TFile[] {
		return [...this.files.values()].filter((f): f is TFile => f instanceof TFile);
	}
	getMarkdownFiles(): TFile[] {
		return this.getFiles().filter((f) => f.extension === "md");
	}
	private parentFor(path: string): TFolder {
		const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/";
		const parent = this.getAbstractFileByPath(dir);
		if (!(parent instanceof TFolder)) throw new Error(`Parent folder doesn't exist: ${dir}`);
		return parent;
	}
	async createFolder(path: string): Promise<TFolder> {
		const p = normalizePath(path);
		if (this.files.has(p)) throw new Error("Folder already exists.");
		const f = new TFolder();
		setPath(f, p);
		f.parent = this.parentFor(p);
		f.parent.children.push(f);
		this.files.set(p, f);
		return f;
	}
	/** Synchronous helper for test setup; creates parent folders. */
	addFile(path: string, content: string | ArrayBuffer = ""): TFile {
		const p = normalizePath(path);
		const parts = p.split("/");
		for (let i = 1; i < parts.length; i++) {
			const sub = parts.slice(0, i).join("/");
			if (!this.files.has(sub)) {
				const d = new TFolder();
				setPath(d, sub);
				d.parent = this.parentFor(sub);
				this.files.set(sub, d);
			}
		}
		const f = new TFile();
		setPath(f, p);
		f.parent = this.parentFor(p);
		f.vault = this;
		this.files.set(p, f);
		this.contents.set(f, content);
		if (typeof content === "string") this.app.metadataCache.index(f, content, true);
		return f;
	}
	async create(path: string, content: string): Promise<TFile> {
		const p = normalizePath(path);
		if (this.files.has(p)) throw new Error("File already exists.");
		this.parentFor(p);
		await Promise.resolve();
		if (this.files.has(p)) throw new Error("File already exists.");
		const f = this.addFile(p, "");
		this.write(f, content);
		this.trigger("create", f);
		return f;
	}
	write(f: TFile, content: string) {
		this.contents.set(f, content);
		this.app.metadataCache.index(f, content);
	}
	async read(f: TFile): Promise<string> {
		return String(this.contents.get(f) ?? "");
	}
	async readBinary(f: TFile): Promise<ArrayBuffer> {
		const c = this.contents.get(f);
		return c instanceof ArrayBuffer ? c : new TextEncoder().encode(String(c ?? "")).buffer;
	}
	rename(f: TFile, newPath: string) {
		const p = normalizePath(newPath);
		if (this.files.has(p)) throw new Error("Destination file already exists!");
		const old = f.path;
		this.files.delete(old);
		setPath(f, p);
		f.parent = this.parentFor(p);
		this.files.set(p, f);
		this.trigger("rename", f, old);
	}
	delete(f: TFile) {
		this.files.delete(f.path);
		this.contents.delete(f);
		this.app.metadataCache.cache.delete(f);
		this.trigger("delete", f);
	}
}

export class MetadataCache extends Events {
	cache = new Map<TFile, Record<string, unknown> | undefined>();
	constructor(private app: App) {
		super();
	}
	/** Index content on a later macrotask (immediately for setup files). */
	index(f: TFile, content: string, now = false) {
		const apply = () => {
			if (this.app.vault.getAbstractFileByPath(f.path) !== f) return;
			if (this.app.vault.contents.get(f) !== content) return;
			this.cache.set(f, splitContent(content).fm ?? undefined);
			this.trigger("changed", f, content, {});
		};
		if (now) this.cache.set(f, splitContent(content).fm ?? undefined);
		else setImmediate(apply);
	}
	getFileCache(f: TFile) {
		return this.cache.has(f) ? { frontmatter: this.cache.get(f) } : null;
	}
	private matches(linkpath: string): TFile[] {
		const lp = normalizePath(linkpath);
		return this.app.vault.getFiles().filter((f) =>
			lp.includes("/")
				? f.path === lp || f.path === `${lp}.md`
				: f.name === lp || (f.extension === "md" && f.basename === lp)
		);
	}
	getFirstLinkpathDest(linkpath: string, _source: string): TFile | null {
		return this.matches(linkpath)[0] ?? null;
	}
	fileToLinktext(f: TFile, _source: string, omitMdExtension = true): string {
		const short = f.extension === "md" && omitMdExtension ? f.basename : f.name;
		const unique = this.matches(short).length === 1;
		const full = f.extension === "md" && omitMdExtension ? f.path.replace(/\.md$/, "") : f.path;
		return unique ? short : full;
	}
}

export class FileManager {
	constructor(private app: App) {}
	async processFrontMatter(f: TFile, fn: (fm: any) => void): Promise<void> {
		await Promise.resolve();
		const { fm, body } = splitContent(String(this.app.vault.contents.get(f) ?? ""));
		const data = fm ?? {};
		fn(data);
		this.app.vault.write(f, joinContent(data, body));
	}
	async renameFile(f: TFile, newPath: string): Promise<void> {
		await Promise.resolve();
		this.app.vault.rename(f, newPath);
	}
}

export class Workspace extends Events {
	active: TFile | null = null;
	opened: TFile[] = [];
	getActiveFile() {
		return this.active;
	}
	onLayoutReady(cb: () => void) {
		cb();
	}
	getLeaf() {
		return { openFile: async (f: TFile) => void this.opened.push(f) };
	}
}

export class App {
	vault: Vault;
	metadataCache: MetadataCache;
	fileManager: FileManager;
	workspace = new Workspace();
	constructor() {
		this.metadataCache = new MetadataCache(this);
		this.vault = new Vault(this);
		this.fileManager = new FileManager(this);
	}
}

export class Notice {
	static messages: string[] = [];
	constructor(message: string, _timeout?: number) {
		Notice.messages.push(message);
	}
	hide() {}
}

export type RequestUrlParam = { url: string; headers?: Record<string, string>; throw?: boolean };
export const http = {
	handler: async (_p: RequestUrlParam): Promise<{ status: number; text: string }> => ({ status: 404, text: "" }),
	calls: [] as string[],
};
export async function requestUrl(p: RequestUrlParam) {
	http.calls.push(p.url);
	return http.handler(p);
}

export function moment() {
	return { format: () => "2026-11-08" };
}

export const pdf = { impl: null as any };
export async function loadPdfJs() {
	return pdf.impl;
}

export class Component {
	private refs: { name: string; cb: Handler; owner: Events }[] = [];
	registerEvent(ref: any) {
		this.refs.push(ref);
	}
	unloadEvents() {
		for (const r of this.refs) r.owner.offref(r);
		this.refs = [];
	}
}

export class Plugin extends Component {
	commands: any[] = [];
	data: unknown = null;
	constructor(public app: App, public manifest: any) {
		super();
	}
	addCommand(c: any) {
		this.commands.push(c);
		return c;
	}
	addSettingTab() {}
	addRibbonIcon() {
		return {};
	}
	async loadData() {
		return this.data;
	}
	async saveData(d: unknown) {
		this.data = d;
	}
	/** What Obsidian does on disable: detach events, then call onunload. */
	unload() {
		this.unloadEvents();
		(this as any).onunload?.();
	}
}

export class Modal {
	contentEl: any = { empty() {}, createEl() {} };
	constructor(public app: App) {}
	open() {}
	close() {}
	setTitle() {}
}
export class PluginSettingTab {
	containerEl: any = { empty() {}, createEl() {} };
	constructor(public app: App, public plugin: unknown) {}
}
export class AbstractInputSuggest<T> {
	limit = 100;
	constructor(public app: App, protected textInputEl: any) {}
	setValue(value: string) {
		this.textInputEl.value = value;
	}
	getValue(): string {
		return this.textInputEl.value;
	}
	close() {}
	/** Test hook: what the suggester would list for a query. */
	suggestionsFor(query: string): T[] {
		return (this as any).getSuggestions(query);
	}
}

export class Setting {
	constructor(_el: unknown) {}
}
