import { App, TFile, normalizePath, parseYaml } from "obsidian";
import {
	DupNote,
	DuplicateGroup,
	MergeOptions,
	PropertyChange,
	findDuplicates,
	mergeBody,
	mergeFrontmatter,
	splitNote,
} from "./duplicates";
import { HealthNote, HealthReport, PdfRepair, ReportContext, checkHealth, healthReportMarkdown } from "./health";
import { Library, unlink } from "./library";
import { FoundLink, findLinks, rewriteLinks } from "./links";
import { LibrarySettings } from "./settings";
import { safeFilename } from "./template";
import { asText, localDate } from "./text";

type Frontmatter = Record<string, unknown>;

/** The health report note's name; it sits beside the references folder. */
export const REPORT_NAME = "Stacks health check";

/** What merging one duplicate into another will do, for the preview. */
export interface MergePlan {
	keep: TFile;
	drop: TFile;
	changes: PropertyChange[];
	annotationsCopied: boolean;
	paragraphsAdded: number;
	/** Notes with links to `drop`, and how many each has. */
	links: { file: TFile; count: number }[];
}

export interface MergeResult {
	linksChanged: number;
	filesChanged: number;
}

const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]);

/**
 * The health check, PDF relinking and duplicate merging, against the vault. Checking only
 * reads; each repair is a separate call made after the person has seen a preview.
 */
export class Maintenance {
	constructor(
		private app: App,
		private library: Library,
		private settings: () => LibrarySettings
	) {}

	/** Resolve a link-ish property value or link path from a note; null if it doesn't resolve. */
	private resolve(value: string, from: TFile): TFile | null {
		const linkpath = unlink(value).split("#")[0].trim();
		return linkpath ? this.app.metadataCache.getFirstLinkpathDest(linkpath, from.path) : null;
	}

	/** Whether a link found in `source`'s text goes to `target`. */
	private pointsTo(link: FoundLink, source: TFile, target: TFile): boolean {
		return !!link.target && this.app.metadataCache.getFirstLinkpathDest(link.target, source.path) === target;
	}

	/** Read a note and try its frontmatter: null with the error when it doesn't parse. */
	private async readNote(file: TFile): Promise<{ text: string; frontmatter: Frontmatter | null; error?: string }> {
		const text = await this.app.vault.cachedRead(file);
		const raw = splitNote(text).frontmatter;
		if (raw) {
			const yaml = raw.replace(/^---\r?\n/, "").replace(/\r?\n?---(?:\r?\n)?$/, "");
			try {
				const parsed: unknown = parseYaml(yaml);
				if (parsed !== null && parsed !== undefined && (typeof parsed !== "object" || Array.isArray(parsed)))
					return { text, frontmatter: null, error: "the frontmatter isn't a list of properties" };
			} catch (e) {
				return { text, frontmatter: null, error: e instanceof Error ? e.message : String(e) };
			}
		}
		// Parsed fine: use the metadata cache's reading, as the rest of the plugin does.
		return { text, frontmatter: this.library.frontmatter(file) };
	}

	private dupNotes(files = this.library.referenceFiles()): DupNote[] {
		return files.map((f) => ({ path: f.path, basename: f.basename, frontmatter: this.library.frontmatter(f) }));
	}

	/** Groups of reference notes with the same DOI, ISBN, URL, or title and year. */
	duplicateGroups(): DuplicateGroup[] {
		const s = this.settings();
		return findDuplicates(this.dupNotes(), { properties: s.propertyNames, urlProperties: s.urlProperties });
	}

	/** Run every check. Reads only. */
	async check(now = Date.now()): Promise<HealthReport> {
		const s = this.settings();
		const lib = this.library;
		const notes: HealthNote[] = [];
		const readable: TFile[] = [];
		for (const file of lib.referenceFiles()) {
			const { text, frontmatter, error } = await this.readNote(file);
			const linked = new Set<string>();
			for (const l of findLinks(text)) {
				const dest = l.target ? this.app.metadataCache.getFirstLinkpathDest(l.target, file.path) : null;
				if (dest) linked.add(dest.path);
			}
			const note: HealthNote = { path: file.path, basename: file.basename, frontmatter, parseError: error, pdfNames: [], linked: [], modified: file.stat?.mtime ?? 0 };
			if (frontmatter) {
				readable.push(file);
				// Bare paths in properties count as links too.
				for (const key of ["pdf", "attachments"] as const)
					for (const v of listOf(frontmatter[lib.prop(key)])) {
						const dest = this.resolve(asText(v), file);
						if (dest) linked.add(dest.path);
					}
				const pdfValue = listOf(frontmatter[lib.prop("pdf")]).map(asText).find((v) => v.trim());
				if (pdfValue) note.pdf = { value: pdfValue, resolves: !!this.resolve(pdfValue, file) };
				const citekey = asText(frontmatter[lib.prop("citekey")]).trim();
				if (citekey) {
					const inputs = lib.keyInputsFromNote(file);
					note.expectedBasename = lib.formatName(s.filenameFormat, citekey, inputs);
					note.pdfNames = [...new Set([`${safeFilename(citekey)}.pdf`, `${lib.formatName(s.attachmentFilenameFormat, citekey, inputs)}.pdf`])];
				}
			}
			note.linked = [...linked];
			notes.push(note);
		}
		const pdfs = this.app.vault
			.getFiles()
			.filter((f) => f.extension.toLowerCase() === "pdf")
			.map((f) => ({ path: f.path, inAttachments: lib.inFolder(f, s.attachmentsFolder) }));
		const duplicates = findDuplicates(this.dupNotes(readable), { properties: s.propertyNames, urlProperties: s.urlProperties });
		return checkHealth(
			{ notes, pdfs, duplicates },
			{ properties: s.propertyNames, staleDays: s.healthStaleDays, staleStatuses: s.healthStaleStatuses, now }
		);
	}

	/** Where the report note goes: beside the references folder. */
	reportPath(): string {
		const folder = normalizePath(this.settings().referencesFolder);
		const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
		return normalizePath(`${parent}/${REPORT_NAME}.md`);
	}

	/** Write (or rewrite) the report note. The only file the health check writes. */
	async writeReport(report: HealthReport, commands: ReportContext["commands"]): Promise<TFile> {
		const s = this.settings();
		const md = healthReportMarkdown(report, { date: localDate(new Date(), true), staleDays: s.healthStaleDays, commands, properties: s.propertyNames });
		const path = this.reportPath();
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.vault.process(existing, () => md);
			return existing;
		}
		return this.app.vault.create(path, md);
	}

	/**
	 * Point a note's pdf at the repair's PDF and list it in its attachments, replacing the
	 * broken link there too. Skipped (false) when the note or PDF is gone or the note's pdf
	 * changed since the check.
	 */
	async applyRepair(r: PdfRepair): Promise<boolean> {
		return this.library.exclusive(async () => {
			const note = this.app.vault.getAbstractFileByPath(r.note);
			const pdf = this.app.vault.getAbstractFileByPath(r.pdf);
			if (!(note instanceof TFile) || !(pdf instanceof TFile)) return false;
			const pdfKey = this.library.prop("pdf");
			const attKey = this.library.prop("attachments");
			const link = this.library.linkTo(pdf, note);
			let applied = false;
			await this.app.fileManager.processFrontMatter(note, (fm: Frontmatter) => {
				const current = listOf(fm[pdfKey]).map(asText).find((v) => v.trim());
				if ((current ?? undefined) !== r.previous) return;
				fm[pdfKey] = link;
				const old = r.previous === undefined ? undefined : unlink(r.previous);
				const list = listOf(fm[attKey]).map((v) => (old !== undefined && unlink(v) === old ? link : v));
				const unique = list.filter((v, i) => list.findIndex((x) => unlink(x) === unlink(v)) === i);
				if (!unique.some((v) => unlink(v) === unlink(link))) unique.push(link);
				fm[attKey] = unique;
				applied = true;
			});
			return applied;
		});
	}

	private mergeOptions(): MergeOptions {
		const p = (k: Parameters<Library["prop"]>[0]) => this.library.prop(k);
		return { listProperties: [p("collections"), p("attachments"), "tags", "aliases"], skip: [p("citekey")] };
	}

	/** Notes (other than `target` itself) whose text links to `target`, with counts. Reads only. */
	async linksTo(target: TFile, alsoCheck: TFile[] = []): Promise<{ file: TFile; count: number }[]> {
		// Obsidian's link index narrows the search; without it, every note is read. Notes just
		// written (the kept note) may not be indexed yet, so they are read regardless.
		const resolved = (this.app.metadataCache as { resolvedLinks?: Record<string, Record<string, number>> }).resolvedLinks;
		const indexed = resolved
			? Object.keys(resolved).filter((src) => resolved[src]?.[target.path])
			: this.app.vault.getMarkdownFiles().map((f) => f.path);
		const sources = [...new Set([...indexed, ...alsoCheck.map((f) => f.path)])];
		const out: { file: TFile; count: number }[] = [];
		for (const src of sources.sort()) {
			const file = this.app.vault.getAbstractFileByPath(src);
			if (!(file instanceof TFile) || file === target || file.extension !== "md") continue;
			const text = await this.app.vault.cachedRead(file);
			const count = findLinks(text).filter((l) => this.pointsTo(l, file, target)).length;
			if (count) out.push({ file, count });
		}
		return out;
	}

	/** What merging `drop` into `keep` would change. Reads only. */
	async planMerge(keep: TFile, drop: TFile): Promise<MergePlan> {
		const { changes } = mergeFrontmatter(this.library.frontmatter(keep), this.library.frontmatter(drop), this.mergeOptions());
		const body = mergeBody(splitNote(await this.app.vault.read(keep)).body, splitNote(await this.app.vault.read(drop)).body, {
			dropName: drop.basename,
			annotationsHeading: this.settings().annotationsHeading,
		});
		return { keep, drop, changes, annotationsCopied: body.annotationsCopied, paragraphsAdded: body.paragraphsAdded, links: await this.linksTo(drop, [keep]) };
	}

	/**
	 * Merge `drop` into `keep`: fill and combine properties, copy what only `drop`'s body has,
	 * point every link to `drop` at `keep`, then move `drop` to the trash. Works from the notes
	 * as they are now, so edits made since the preview are respected.
	 */
	async merge(plan: MergePlan): Promise<MergeResult> {
		const { keep, drop } = plan;
		return this.library.exclusive(async () => {
			if (!this.library.exists(keep) || !this.library.exists(drop)) throw new Error(`${keep.basename} or ${drop.basename} was moved or deleted. Nothing was merged.`);
			const options = this.mergeOptions();
			const dropFm = { ...this.library.frontmatter(drop) };
			const dropBody = splitNote(await this.app.vault.read(drop)).body;
			await this.app.fileManager.processFrontMatter(keep, (fm: Frontmatter) => {
				Object.assign(fm, mergeFrontmatter(fm, dropFm, options).updates);
			});
			const annotationsHeading = this.settings().annotationsHeading;
			await this.app.vault.process(keep, (text) => {
				const { frontmatter, body } = splitNote(text);
				return frontmatter + mergeBody(body, dropBody, { dropName: drop.basename, annotationsHeading }).body;
			});
			let linksChanged = 0;
			let filesChanged = 0;
			for (const { file } of await this.linksTo(drop, [keep])) {
				const linktext = this.app.metadataCache.fileToLinktext(keep, file.path, true);
				let count = 0;
				await this.app.vault.process(file, (text) => {
					const r = rewriteLinks(text, (l) => this.pointsTo(l, file, drop), linktext);
					count = r.count;
					return r.text;
				});
				linksChanged += count;
				if (count) filesChanged++;
			}
			await this.app.fileManager.trashFile(drop);
			return { linksChanged, filesChanged };
		});
	}
}
