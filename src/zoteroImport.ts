import { App, TFile, moment, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import { Library } from "./library";
import { htmlToText } from "./metadata/html";
import { LibrarySettings } from "./settings";
import { BbtExport, ImportChoices, ImportOptions, ImportPlan, ImportReport, PlannedCreate, PlannedUpdate, VaultNote, parseTagRules, planImport } from "./zotero";

export type { ImportChoices };

type Frontmatter = Record<string, unknown>;

/** Everything one import wrote, so it can be undone. Saved in the plugin's folder. */
export interface ImportBackup {
	version: 1;
	date: string;
	reportPath: string;
	created: string[];
	/** Each modified note's full text before the import, under its path before any rename. */
	modified: { path: string; text: string }[];
	renamed: { from: string; to: string }[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---(?:\r?\n|$)/;

/** Runs a Zotero import: reads the export and the vault, plans, applies, reports, undoes. */
export class ZoteroImporter {
	constructor(
		private app: App,
		private library: Library,
		private settings: () => LibrarySettings,
		/** Folder for import backups, inside the plugin's own folder. */
		private backupDir: string
	) {}

	async readExport(path: string): Promise<BbtExport> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path.trim()));
		if (!(file instanceof TFile)) throw new Error(`No file at ${path}. Put the Better BibTeX JSON export in your vault and choose it.`);
		let data: unknown;
		try {
			data = JSON.parse(await this.app.vault.read(file));
		} catch {
			throw new Error(`${path} isn't valid JSON.`);
		}
		const items = (data as BbtExport | null)?.items;
		if (!Array.isArray(items) || items.some((i) => !i || typeof i.key !== "string" || typeof i.itemType !== "string"))
			throw new Error(`${path} isn't a Better BibTeX JSON export (export with the "Better BibTeX JSON" format).`);
		return data as BbtExport;
	}

	/** The reference notes, with frontmatter read leniently so broken YAML can be repaired. */
	async vaultNotes(): Promise<VaultNote[]> {
		const out: VaultNote[] = [];
		for (const f of this.library.referenceFiles()) {
			const text = await this.app.vault.cachedRead(f);
			const m = text.match(FRONTMATTER);
			let frontmatter: Frontmatter | null = {};
			if (m) {
				try {
					const parsed = parseYaml(m[1]);
					frontmatter = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Frontmatter) : {};
				} catch {
					frontmatter = null;
				}
			}
			out.push({ path: f.path, basename: f.basename, frontmatter, rawFrontmatter: m?.[1], body: m ? text.slice(m[0].length) : text });
		}
		return out;
	}

	options(choices: ImportChoices): ImportOptions {
		const s = this.settings();
		return {
			properties: s.propertyNames,
			collections: choices.collections,
			tags: parseTagRules(choices.tagRules).rules,
			statuses: s.statuses,
			fallbackStatus: choices.fallbackStatus,
			annotatedStatus: choices.annotatedStatus,
			automaticTags: choices.automaticTags,
			createMissing: choices.createMissing,
			renameToCurrentKeys: choices.renameToCurrentKeys,
			zoteroWins: choices.zoteroWins,
			referencesFolder: s.referencesFolder,
			findAttachment: (name) => {
				const f = this.app.metadataCache.getFirstLinkpathDest(name, "");
				return f && f.name === name ? f.path : undefined;
			},
			parseYaml: (t) => parseYaml(t),
		};
	}

	/** The dry run: read everything, decide everything, write nothing. */
	async plan(choices: ImportChoices): Promise<{ plan: ImportPlan; exp: BbtExport }> {
		const exp = await this.readExport(choices.exportPath);
		return { plan: planImport(exp, await this.vaultNotes(), this.options(choices)), exp };
	}

	/** Properties for a planned note: bibliographic fields, then the workflow fields. */
	private properties(entry: PlannedUpdate | PlannedCreate): { biblio: Frontmatter; workflow: Frontmatter } {
		const p = (k: Parameters<Library["prop"]>[0]) => this.library.prop(k);
		const { data, extras } = entry;
		const biblio = this.library.propertiesFor(data, extras.citekey);
		delete biblio[p("status")];
		delete biblio[p("added")];
		const link = (path: string) => `[[${this.app.metadataCache.fileToLinktext(this.app.vault.getAbstractFileByPath(path) as TFile, "", false)}]]`;
		const pdf = extras.attachments.find((a) => /\.pdf$/i.test(a));
		const workflow: Frontmatter = {
			[p("collections")]: extras.collections.length ? extras.collections.map((c) => `[[${c}]]`) : undefined,
			tags: extras.tags.length ? extras.tags : undefined,
			[p("status")]: extras.status,
			...extras.tagProperties,
			[p("pdf")]: pdf ? link(pdf) : undefined,
			[p("attachments")]: extras.attachments.length ? extras.attachments.map(link) : undefined,
			[p("added")]: extras.added,
			[p("zotero")]: extras.zotero,
		};
		for (const k of Object.keys(workflow)) if (workflow[k] === undefined) delete workflow[k];
		return { biblio, workflow };
	}

	/**
	 * Apply a plan. Notes' bodies are never changed (broken frontmatter is replaced by its
	 * repair). Existing values are kept unless "Zotero wins" is on, which applies to
	 * bibliographic fields only; workflow fields such as status are always filled, never replaced.
	 */
	async apply(plan: ImportPlan, choices: ImportChoices, onProgress: (done: number, total: number) => void = () => undefined): Promise<ImportBackup> {
		const stamp = moment().format("YYYY-MM-DD HHmm");
		const backup: ImportBackup = { version: 1, date: stamp, reportPath: "", created: [], modified: [], renamed: [] };
		const total = plan.updates.length + plan.creates.length;
		let done = 0;
		// Save the originals before writing anything.
		for (const u of plan.updates) {
			const file = this.app.vault.getAbstractFileByPath(u.note.path);
			if (file instanceof TFile) backup.modified.push({ path: file.path, text: await this.app.vault.read(file) });
		}
		const backupPath = await this.saveBackup(backup, stamp);
		try {
			for (const u of plan.updates) {
				const file = this.app.vault.getAbstractFileByPath(u.note.path);
				if (!(file instanceof TFile)) continue;
				await this.library.exclusive(async () => {
					if (u.repaired) {
						const repaired = `---\n${stringifyYaml(u.repaired)}---\n`;
						await this.app.vault.process(file, (text) => {
							const m = text.match(FRONTMATTER);
							return repaired + (m ? text.slice(m[0].length) : text);
						});
					}
					const { biblio, workflow } = this.properties(u);
					await this.app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
						const citekeyProp = this.library.prop("citekey");
						for (const [k, v] of Object.entries(biblio)) {
							const replace = choices.zoteroWins && k !== citekeyProp;
							if (empty(fm[k]) || replace) fm[k] = v;
						}
						// A rename to the current key updates the citekey; otherwise an existing one stays.
						if (u.renameTo || empty(fm[citekeyProp])) fm[citekeyProp] = u.extras.citekey;
						for (const [k, v] of Object.entries(workflow)) if (empty(fm[k])) fm[k] = v;
					});
					if (u.renameTo && !this.app.vault.getAbstractFileByPath(u.renameTo)) {
						const from = file.path;
						await this.app.fileManager.renameFile(file, u.renameTo);
						backup.renamed.push({ from, to: file.path });
					}
				});
				onProgress(++done, total);
			}
			for (const c of plan.creates) {
				await this.library.exclusive(async () => {
					if (this.app.vault.getAbstractFileByPath(c.path)) return;
					await this.library.ensureFolder(c.path.slice(0, c.path.lastIndexOf("/")) || "/");
					const data = { ...c.data, title: c.data.title || c.extras.citekey };
					let body = await this.library.renderBody(data, c.extras.citekey);
					const notes = c.extras.notes.map((n) => htmlToText(n)).filter(Boolean);
					if (notes.length) body = body.replace(/\n*$/, "\n") + `\n## Zotero notes\n\n${notes.join("\n\n---\n\n")}\n`;
					const file = await this.app.vault.create(c.path, body);
					backup.created.push(file.path);
					const { biblio, workflow } = this.properties({ ...c, data });
					await this.app.fileManager.processFrontMatter(file, (fm: Frontmatter) => Object.assign(fm, biblio, workflow));
				});
				onProgress(++done, total);
			}
		} finally {
			backup.reportPath = await this.writeReport(plan.report, plan, choices, stamp, backup);
			await this.saveBackup(backup, stamp, backupPath);
		}
		return backup;
	}

	private async saveBackup(backup: ImportBackup, stamp: string, path?: string): Promise<string> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.backupDir))) await adapter.mkdir?.(this.backupDir);
		// Never overwrite an earlier import's backup, even one from the same minute.
		let target = path;
		for (let i = 0; !target; i++) {
			const candidate = normalizePath(`${this.backupDir}/zotero-import ${stamp}${i ? ` ${i}` : ""}.json`);
			if (!(await adapter.exists(candidate))) target = candidate;
		}
		await adapter.write(target, JSON.stringify(backup));
		this.lastBackup = target;
		return target;
	}

	/** Path of the most recent backup written this session (also kept in settings). */
	lastBackup = "";

	/** Undo an import from its backup: renames back, original text restored, created notes to the trash. */
	async undo(backupPath: string): Promise<{ restored: number; trashed: number; skipped: string[] }> {
		const backup = JSON.parse(await this.app.vault.adapter.read(backupPath)) as ImportBackup;
		const skipped: string[] = [];
		for (const r of [...backup.renamed].reverse()) {
			const f = this.app.vault.getAbstractFileByPath(r.to);
			if (f instanceof TFile && !this.app.vault.getAbstractFileByPath(r.from)) await this.app.fileManager.renameFile(f, r.from);
			else skipped.push(r.to);
		}
		let restored = 0;
		for (const m of backup.modified) {
			const f = this.app.vault.getAbstractFileByPath(m.path);
			if (f instanceof TFile) {
				await this.app.vault.modify(f, m.text);
				restored++;
			} else skipped.push(m.path);
		}
		let trashed = 0;
		for (const path of backup.created) {
			const f = this.app.vault.getAbstractFileByPath(path);
			if (f instanceof TFile) {
				await this.app.fileManager.trashFile(f);
				trashed++;
			}
		}
		return { restored, trashed, skipped };
	}

	/** A Markdown report of the import beside the references folder; returns its path. */
	private async writeReport(r: ImportReport, plan: ImportPlan, choices: ImportChoices, stamp: string, backup: ImportBackup): Promise<string> {
		const folder = this.settings().referencesFolder.replace(/\/+$/, "");
		const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
		const path = this.library.freePath(parent || "/", `Zotero import ${stamp}`, "md");
		await this.app.vault.create(path, importReportMarkdown(r, plan, choices, backup));
		return path;
	}
}

const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.some((x) => x !== null && x !== ""));

const link = (path: string) => `[[${path.replace(/\.md$/, "")}]]`;

/** The import report as Markdown: counts first, then each list needing a look. Deterministic. */
export function importReportMarkdown(r: ImportReport, plan: ImportPlan, choices: ImportChoices, backup?: ImportBackup): string {
	const lines: string[] = [];
	const section = (heading: string, items: string[], note = "") => {
		if (!items.length) return;
		lines.push("", `## ${heading} (${items.length})`, "");
		if (note) lines.push(note, "");
		for (const i of [...items].sort()) lines.push(`- ${i}`);
	};
	lines.push(`# Zotero import`, "", `From \`${choices.exportPath}\`. ${backup ? "Written" : "Dry run: nothing written"}.`, "");
	lines.push("| | Count |", "|---|---|");
	const row = (k: string, v: number) => lines.push(`| ${k} | ${v} |`);
	row("Items in the export", r.items);
	row("Notes updated", plan.updates.length);
	for (const [by, n] of Object.entries(r.matched)) if (n) row(`· matched by ${by}`, n);
	row("Notes created", plan.creates.length);
	row("Notes renamed to current citekeys", r.keyChanges.filter((k) => k.renamed).length);
	row("Frontmatter repaired", r.repairedNotes.length);
	row("Web snapshots left in Zotero's storage", r.snapshotsLeftInZotero);
	row("Zotero child notes not copied into existing notes", r.zoteroNotesNotCopied);
	section("Duplicates in Zotero, not created", r.zoteroDuplicates.map((d) => `\`${d.citekey}\` "${d.title}" matches ${link(d.note)}. Consider deleting it in Zotero.`));
	section("Items without a note, not created", r.notCreated.map((k) => `\`${k}\``));
	section("Duplicate notes to merge", r.duplicateNotes.map((d) => `${link(d.note)} is another note for \`${d.citekey}\`, kept as ${link(d.keptNote)}`), "Move any unique annotations into the kept note, point links at it, then delete the duplicate.");
	section(
		"Citekeys that changed in Better BibTeX",
		r.keyChanges.map((k) => `${link(k.note)} → \`${k.citekey}\`${k.renamed ? " (renamed)" : k.reason ? ` (not renamed: ${k.reason})` : ""}`)
	);
	section("Notes from a group library", r.groupNotes.map(link), "A personal export doesn't include group libraries. These notes keep their own properties.");
	section("Notes whose Zotero item isn't in the export", r.missingFromExport.map(link), "Probably deleted from Zotero after the note was made.");
	section("Repaired frontmatter", r.repairedNotes.map(link));
	section("Status decided against a collection", r.statusConflicts.map((c) => `${c.note.endsWith(".md") ? link(c.note) : `\`${c.note}\``}: ${c.detail}`));
	section("Attachments outside the vault", r.attachmentsNotInVault.map((a) => `\`${a.citekey}\`: ${a.path}`), "Move them into the vault (for example, your attachments folder) and run the import again to link them.");
	section(
		"Zotero fields not imported",
		Object.entries(r.unmappedFields).map(([f, n]) => `\`${f}\`: ${n} items`),
		"These fields aren't part of the citation record (see docs/citation-fields.md)."
	);
	lines.push("", "## Annotations", "", "Better BibTeX exports don't include annotations made in Zotero's PDF reader. Highlights already in your notes (for example from the Zotero Integration plugin) are untouched. To bring the rest across, in Zotero choose File → Export PDF… on each annotated PDF, which writes the annotations into the file, and keep that PDF in your vault.");
	if (backup) lines.push("", "## Undo", "", `Run **Library: Undo last Zotero import** to restore every changed note, rename notes back and move created notes to the trash.`);
	return lines.join("\n") + "\n";
}
