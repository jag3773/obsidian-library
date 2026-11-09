/**
 * Reading round trip: copy a reference's PDF to a folder a tablet app syncs with, notice when
 * it comes back changed, bring it home and extract its annotations.
 *
 * Desktop only. All file-system and process access goes through a Host, which the plugin
 * builds from Node's modules on desktop (desktop.ts) and tests build over a temp folder.
 */

import { App, TFile, normalizePath } from "obsidian";
import { ExtractSummary, Extractor, describeExtraction } from "./extract";
import { Cancelled, Library } from "./library";
import { readAnnotations } from "./pdf";
import { LibrarySettings } from "./settings";
import { localDate } from "./text";

/** What Stacks sent to the tablet folder, so a returned file can be matched and checked. */
export interface SentRecord {
	/** File name in the tablet folder. */
	file: string;
	/** Vault path of the attachment it came from (kept current across renames). */
	attachment: string;
	/** Vault path of the reference note. */
	note: string;
	/** SHA-256 of the vault copy at the last sync; a different value means it changed in the vault. */
	vaultHash: string;
	/** SHA-256 of the tablet copy at the last sync; a different value means it came back changed. */
	externalHash: string;
	/** Size and mtime of the tablet copy at the last sync, to skip hashing unchanged files. */
	externalSize: number;
	externalMtime: number;
	sentAt: string;
	returnedAt?: string;
}

export interface FileStat {
	size: number;
	mtimeMs: number;
}

/** File-system and process access, desktop only. */
export interface Host {
	join(dir: string, name: string): string;
	readFile(path: string): Promise<Uint8Array>;
	writeFile(path: string, data: Uint8Array): Promise<void>;
	stat(path: string): Promise<FileStat | null>;
	isDirectory(path: string): Promise<boolean>;
	list(dir: string): Promise<string[]>;
	/** Call onChange with a file name whenever something in dir changes. Returns a stop function. */
	watch(dir: string, onChange: (name: string) => void): () => void;
	/** A fresh private temporary folder. */
	tempDir(): Promise<string>;
	removeDir(path: string): Promise<void>;
	/** Run a shell command; resolves with its exit code and combined output. */
	run(command: string, cwd: string | null, timeoutMs: number): Promise<{ code: number | null; output: string }>;
	/** Quote a path for the platform's shell. */
	quote(path: string): string;
	/** The vault's folder on disk, or null when the vault isn't on the local file system. */
	vaultPath(): string | null;
}

export type ReturnState = "unchanged" | "returned" | "conflict";

/**
 * Compare the copies with what was synced. The tablet copy changed and the vault copy didn't:
 * returned. Both changed: conflict. Tablet copy unchanged: nothing to do.
 */
export function classifyReturn(rec: Pick<SentRecord, "vaultHash" | "externalHash">, externalHash: string, vaultHash: string): ReturnState {
	if (externalHash === rec.externalHash || externalHash === vaultHash) return "unchanged";
	return vaultHash === rec.vaultHash ? "returned" : "conflict";
}

export async function sha256(data: ArrayBuffer | Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", (data instanceof Uint8Array ? data : new Uint8Array(data)) as Uint8Array<ArrayBuffer>);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const isPdf = (bytes: Uint8Array) => bytes.length > 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";

const PRE_COMMAND_TIMEOUT_MS = 5 * 60_000;

/**
 * Run the pre-extraction command on a copy of the PDF. Returns the command's output PDF, or
 * null when it wrote none (the command may work in place on {in}, which is then read back).
 * Throws with the command's output when it fails.
 */
export async function runPreExtraction(host: Host, command: string, bytes: Uint8Array, name: string): Promise<Uint8Array | null> {
	const dir = await host.tempDir();
	try {
		const input = host.join(dir, name.replace(/[^\w.-]+/g, "_") || "in.pdf");
		const output = host.join(dir, "out.pdf");
		await host.writeFile(input, bytes);
		const cmd = command.replace(/\{in\}/g, () => host.quote(input)).replace(/\{out\}/g, () => host.quote(output));
		const { code, output: log } = await host.run(cmd, host.vaultPath(), PRE_COMMAND_TIMEOUT_MS);
		if (code !== 0) throw new Error(`pre-extraction command ${code === null ? "timed out" : `exited with ${code}`}: ${log.trim().slice(-300) || "(no output)"}`);
		const result = (await host.stat(output)) ? await host.readFile(output) : await host.readFile(input);
		if (!isPdf(result)) throw new Error("pre-extraction command did not produce a PDF");
		return result;
	} finally {
		await host.removeDir(dir).catch(() => undefined);
	}
}

/** Both copies of a diverged PDF, for the person to choose between. */
export interface ConflictInfo {
	note: TFile;
	attachment: TFile;
	vault: FileStat & { annotations?: number };
	tablet: FileStat & { annotations?: number };
}
export type ConflictChoice = "tablet" | "vault" | "later";

export interface RoundTripUi {
	notice(message: string): void;
	/** Ask which copy to keep. Both are always preserved; the choice decides which stays the note's PDF. */
	conflict(info: ConflictInfo): Promise<ConflictChoice>;
}

const SETTLE_MS = 1500;
const SETTLE_TRIES = 20;

export class RoundTrip {
	private chain: Promise<unknown> = Promise.resolve();
	private stopWatching: (() => void) | null = null;
	private watchTimers = new Map<string, number>();
	/** Shorter in tests. */
	settleMs = SETTLE_MS;

	constructor(
		private app: App,
		private library: Library,
		private extractor: Extractor,
		private settings: () => LibrarySettings,
		private save: () => Promise<void>,
		private host: Host,
		private ui: RoundTripUi,
		/** Mark a vault path as being written by Stacks, so its own writes don't retrigger handlers. */
		private markBusy: (path: string) => void = () => undefined,
		private active: () => boolean = () => true
	) {}

	private get s(): LibrarySettings {
		return this.settings();
	}

	folder(): string | null {
		const f = this.s.tabletFolder.trim();
		return f || null;
	}

	/** One operation at a time, so a watcher burst and a scan can't import the same file twice. */
	private serial<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.chain.then(() => (this.active() ? fn() : (undefined as T)));
		this.chain = run.catch(() => undefined);
		return run;
	}

	private async requireFolder(): Promise<string> {
		const folder = this.folder();
		if (!folder) throw new Error("set a tablet folder in Stacks' settings first.");
		if (!(await this.host.isDirectory(folder))) throw new Error(`the tablet folder ${folder} doesn't exist or isn't reachable.`);
		return folder;
	}

	private vaultBytes(file: TFile): Promise<Uint8Array> {
		return this.app.vault.readBinary(file).then((b) => new Uint8Array(b));
	}

	/** Copy the note's PDF to the tablet folder. */
	send(note: TFile): Promise<string> {
		return this.serial(async () => {
			const folder = await this.requireFolder();
			const pdf = this.extractor.pdfFor(note);
			if (!pdf) throw new Error(`${note.basename} has no PDF to send.`);
			// An attachment sent before keeps its name in the tablet folder, even if renamed in the vault since.
			const name = Object.values(this.s.tabletSent).find((r) => r.attachment === pdf.path)?.file ?? pdf.name;
			const target = this.host.join(folder, name);
			const bytes = await this.vaultBytes(pdf);
			const hash = await sha256(bytes);
			const rec = this.s.tabletSent[name];
			if (rec && rec.attachment !== pdf.path && this.app.vault.getAbstractFileByPath(rec.attachment))
				throw new Error(`the tablet folder already holds ${name} for ${rec.attachment}.`);
			const there = await this.host.stat(target);
			if (there) {
				const theirs = await sha256(await this.host.readFile(target));
				if (theirs === hash) {
					await this.record(name, pdf, note, hash, theirs, there, "sent");
					return `${name} is already in the tablet folder.`;
				}
				// Never overwrite reading the person hasn't brought back.
				if (!rec || theirs !== rec.externalHash)
					throw new Error(`the tablet copy of ${name} has changes that aren't in the vault yet. Run "Check tablet folder" first.`);
			}
			await this.host.writeFile(target, bytes);
			const stat = await this.host.stat(target);
			await this.record(name, pdf, note, hash, hash, stat ?? { size: bytes.length, mtimeMs: Date.now() }, "sent");
			return `sent ${name} to the tablet folder.`;
		});
	}

	/**
	 * Remember the state of both copies, under the file's name in the tablet folder (which stays
	 * the same when the attachment is renamed in the vault). `event` says whether this was a
	 * send, a return, or just a re-check.
	 */
	private async record(name: string, pdf: TFile, note: TFile, vaultHash: string, externalHash: string, stat: FileStat, event: "sent" | "returned" | "checked"): Promise<void> {
		const prev = this.s.tabletSent[name];
		const now = new Date().toISOString();
		this.s.tabletSent[name] = {
			file: name,
			attachment: pdf.path,
			note: note.path,
			vaultHash,
			externalHash,
			externalSize: stat.size,
			externalMtime: stat.mtimeMs,
			sentAt: event === "sent" || !prev?.sentAt ? now : prev.sentAt,
			...(event === "returned" ? { returnedAt: now } : event === "checked" && prev?.returnedAt ? { returnedAt: prev.returnedAt } : {}),
		};
		await this.save();
	}

	/** Keep records pointing at the attachment and note after a rename in the vault. */
	async onVaultRename(file: TFile, oldPath: string): Promise<void> {
		let changed = false;
		for (const rec of Object.values(this.s.tabletSent)) {
			if (rec.attachment === oldPath) {
				rec.attachment = file.path;
				changed = true;
			}
			if (rec.note === oldPath) {
				rec.note = file.path;
				changed = true;
			}
		}
		if (changed) await this.save();
	}

	/** Look at every PDF in the tablet folder (startup, or the command). Returns how many came back. */
	checkAll(explicit = false): Promise<number> {
		return this.serial(async () => {
			const folder = await this.requireFolder();
			let n = 0;
			for (const name of await this.host.list(folder)) {
				if (!/\.pdf$/i.test(name)) continue;
				if (!this.active()) break;
				try {
					if (await this.handle(folder, name)) n++;
				} catch (e) {
					this.ui.notice(`Stacks: couldn't bring back ${name}: ${e instanceof Error ? e.message : String(e)}`);
				}
			}
			if (explicit) this.ui.notice(n ? `Stacks: brought back ${n} PDF${n === 1 ? "" : "s"} from the tablet folder.` : "Stacks: no changed PDFs in the tablet folder.");
			return n;
		});
	}

	/** Look at one file in the tablet folder (from the watcher). */
	checkOne(name: string): Promise<boolean> {
		return this.serial(async () => {
			const folder = this.folder();
			if (!folder || !/\.pdf$/i.test(name)) return false;
			try {
				return await this.handle(folder, name);
			} catch (e) {
				this.ui.notice(`Stacks: couldn't bring back ${name}: ${e instanceof Error ? e.message : String(e)}`);
				return false;
			}
		});
	}

	/**
	 * Wait until a file stops changing (a sync client may still be writing it). Null when it
	 * disappears or is still changing after the last try: the watcher or the next check retries.
	 */
	private async settled(path: string): Promise<FileStat | null> {
		let prev = await this.host.stat(path);
		for (let i = 0; prev && i < SETTLE_TRIES; i++) {
			await new Promise((r) => window.setTimeout(r, this.settleMs));
			const now = await this.host.stat(path);
			if (!now) return null;
			if (now.size === prev.size && now.mtimeMs === prev.mtimeMs) return now;
			prev = now;
		}
		return null;
	}

	/** Throw unless PDF.js can open the bytes: checked before anything replaces a vault copy. */
	private async assertReadable(bytes: Uint8Array, name: string): Promise<void> {
		try {
			await readAnnotations(bytes, name);
		} catch (e) {
			throw new Error(`the copy isn't a readable PDF yet (${e instanceof Error ? e.message : String(e)})`);
		}
	}

	/** True when the vault copy still has the content it had when the decision was made. */
	private async vaultStill(pdf: TFile, hash: string): Promise<boolean> {
		return this.library.exists(pdf) && (await sha256(await this.vaultBytes(pdf))) === hash;
	}

	/** The vault attachment a record belongs to, following renames made while Obsidian was closed. */
	private async attachmentFor(rec: SentRecord): Promise<{ pdf: TFile; note: TFile } | null> {
		const at = this.app.vault.getAbstractFileByPath(rec.attachment);
		const noteFile = this.app.vault.getAbstractFileByPath(rec.note);
		const note = noteFile instanceof TFile ? noteFile : null;
		if (at instanceof TFile) return note ? { pdf: at, note } : this.withNote(at);
		// The note's own PDF, then any PDF in the attachments folder with the content we last synced.
		const fromNote = note ? this.extractor.pdfFor(note) : null;
		if (fromNote && note) return { pdf: fromNote, note };
		for (const f of this.app.vault.getFiles()) {
			if (f.extension !== "pdf" || !this.library.inFolder(f, this.s.attachmentsFolder)) continue;
			if ((await sha256(await this.vaultBytes(f))) === rec.vaultHash) return this.withNote(f);
		}
		return null;
	}

	private withNote(pdf: TFile): { pdf: TFile; note: TFile } | null {
		const note = this.extractor.notesFor(pdf)[0];
		return note ? { pdf, note } : null;
	}

	/** A PDF in the tablet folder Stacks didn't send: an attachment of the same name, if it's newer. */
	private async adopt(name: string, stat: FileStat): Promise<{ pdf: TFile; note: TFile } | null> {
		if (!this.s.tabletAdoptUnknown) return null;
		const pdf = this.app.vault
			.getFiles()
			.find((f) => f.extension === "pdf" && f.name === name && this.library.inFolder(f, this.s.attachmentsFolder));
		if (!pdf || stat.mtimeMs <= pdf.stat.mtime) return null;
		return this.withNote(pdf);
	}

	/** Bring one file back if it changed. Returns true when it was imported. */
	private async handle(folder: string, name: string): Promise<boolean> {
		const path = this.host.join(folder, name);
		let rec = this.s.tabletSent[name];
		const quick = await this.host.stat(path);
		if (!quick) return false;
		// Unchanged since the last sync: skip without reading the file.
		if (rec && quick.size === rec.externalSize && quick.mtimeMs === rec.externalMtime) return false;
		const stat = await this.settled(path);
		if (!stat) return false;
		const target = rec ? await this.attachmentFor(rec) : await this.adopt(name, stat);
		if (!target) {
			if (rec) this.ui.notice(`Stacks: ${name} changed in the tablet folder, but its attachment is no longer in the vault.`);
			return false;
		}
		const theirs = await this.host.readFile(path);
		if (!isPdf(theirs)) throw new Error("the tablet copy isn't a complete PDF yet");
		const theirHash = await sha256(theirs);
		const ours = await this.vaultBytes(target.pdf);
		const ourHash = await sha256(ours);
		// Without a record, the vault copy is the baseline.
		rec ??= { file: name, attachment: target.pdf.path, note: target.note.path, vaultHash: ourHash, externalHash: ourHash, externalSize: 0, externalMtime: 0, sentAt: "" };
		const state = classifyReturn(rec, theirHash, ourHash);
		if (state === "unchanged") {
			// Remember the stat so the next scan skips it. The baseline moves only when the two
			// copies are identical: a vault edit that never reached the tablet stays an edit, so a
			// later return still shows up as a conflict instead of overwriting it.
			const inSync = theirHash === ourHash;
			await this.record(name, target.pdf, target.note, inSync ? ourHash : rec.vaultHash, inSync ? theirHash : rec.externalHash, stat, "checked");
			return false;
		}
		await this.assertReadable(theirs, name);
		if (state === "conflict") {
			const choice = await this.ui.conflict({
				note: target.note,
				attachment: target.pdf,
				vault: { size: ours.length, mtimeMs: target.pdf.stat.mtime, annotations: await this.countAnnotations(ours, target.pdf.name) },
				tablet: { ...stat, annotations: await this.countAnnotations(theirs, name) },
			});
			if (choice === "later") return false;
			// The dialog may have stayed open a while: decide again if the vault copy changed meanwhile.
			if (!(await this.vaultStill(target.pdf, ourHash))) {
				this.ui.notice(`Stacks: ${target.pdf.name} changed in the vault while you were deciding; nothing was replaced, and you'll be asked again.`);
				return false;
			}
			if (choice === "vault") {
				await this.keepCopy(target, theirs, "tablet");
				await this.record(name, target.pdf, target.note, ourHash, theirHash, stat, "returned");
				this.ui.notice(`Stacks: kept the vault copy of ${target.pdf.name}; the tablet copy was saved next to it.`);
				return false;
			}
			await this.keepCopy(target, ours, "vault");
		}
		return this.bringBack(name, target, theirs, theirHash, stat, ourHash);
	}

	private async countAnnotations(bytes: Uint8Array, name: string): Promise<number | undefined> {
		try {
			return (await readAnnotations(bytes, name)).annotations.length;
		} catch {
			return undefined;
		}
	}

	/** Save the other version of a diverged PDF next to the attachment, linked from the note. */
	private async keepCopy(target: { pdf: TFile; note: TFile }, bytes: Uint8Array, which: "vault" | "tablet"): Promise<TFile> {
		const folder = target.pdf.parent?.path ?? this.s.attachmentsFolder;
		const path = this.library.freePath(folder, `${target.pdf.basename} (${which} copy ${localDate()})`, "pdf");
		this.markBusy(normalizePath(path));
		const copy = await this.app.vault.createBinary(path, toArrayBuffer(bytes));
		await this.library.linkAttachment(target.note, copy);
		return copy;
	}

	/**
	 * Write the returned copy over the attachment, set the status, extract. `vaultHash` is the
	 * vault copy this replaces; if it changed meanwhile (the pre-extraction command can take
	 * minutes), nothing is replaced and the next check decides again.
	 */
	private async bringBack(name: string, target: { pdf: TFile; note: TFile }, theirs: Uint8Array, theirHash: string, stat: FileStat, vaultHash: string): Promise<boolean> {
		const s = this.s;
		let bytes = theirs;
		if (s.preExtractionCommand.trim()) {
			try {
				const processed = await runPreExtraction(this.host, s.preExtractionCommand, theirs, target.pdf.name);
				if (processed) {
					await this.assertReadable(processed, target.pdf.name);
					bytes = processed;
				}
			} catch (e) {
				this.ui.notice(`Stacks: ${e instanceof Error ? e.message : String(e)}. Using the PDF as it came back.`);
			}
		}
		if (!(await this.vaultStill(target.pdf, vaultHash))) {
			this.ui.notice(`Stacks: ${target.pdf.name} changed in the vault while it was being brought back; nothing was replaced, and it will be checked again.`);
			return false;
		}
		this.assertActiveOrThrow();
		this.markBusy(target.pdf.path);
		await this.app.vault.modifyBinary(target.pdf, toArrayBuffer(bytes));
		await this.record(name, target.pdf, target.note, await sha256(bytes), theirHash, stat, "returned");
		if (s.returnStatus.trim()) {
			this.markBusy(target.note.path);
			await this.app.fileManager.processFrontMatter(target.note, (f: Record<string, unknown>) => {
				f[this.library.prop("status")] = s.returnStatus.trim();
			});
		}
		this.ui.notice(`Stacks: ${target.pdf.name} came back from the tablet; extracting annotations…`);
		try {
			this.markBusy(target.note.path);
			const summary: ExtractSummary = await this.extractor.extract(target.note, toArrayBuffer(bytes));
			this.ui.notice(`Stacks: ${describeExtraction(summary)}`);
		} catch (e) {
			if (e instanceof Cancelled) throw e;
			this.ui.notice(`Stacks: brought back ${target.pdf.name}, but extraction failed: ${e instanceof Error ? e.message : String(e)}`);
		}
		return true;
	}

	private assertActiveOrThrow(): void {
		if (!this.active()) throw new Cancelled();
	}

	/** Watch the tablet folder while Obsidian runs. */
	startWatching(): void {
		this.stopWatching?.();
		this.stopWatching = null;
		const folder = this.folder();
		if (!folder) return;
		try {
			this.stopWatching = this.host.watch(folder, (name) => {
				if (!/\.pdf$/i.test(name)) return;
				const t = this.watchTimers.get(name);
				if (t !== undefined) window.clearTimeout(t);
				this.watchTimers.set(
					name,
					window.setTimeout(() => {
						this.watchTimers.delete(name);
						if (this.active()) void this.checkOne(name);
					}, this.settleMs)
				);
			});
		} catch (e) {
			console.warn("[Stacks] can't watch the tablet folder", e);
		}
	}

	stop(): void {
		this.stopWatching?.();
		this.stopWatching = null;
		for (const t of this.watchTimers.values()) window.clearTimeout(t);
		this.watchTimers.clear();
	}
}

/** Copy into a standalone ArrayBuffer (a Uint8Array may view part of a larger one). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
