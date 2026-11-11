// Shared steps for the Stacks end-to-end specs. Functions passed to browser.executeObsidian
// run inside Obsidian and are serialized, so they can't use anything from this module's scope:
// everything they need is passed as an argument.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

export const VAULT = "test/e2e/vaults/library";
export const STUB_ID = "stacks-e2e-stub";

/** The commands the release under test added or changed, by id (without the "stacks:" prefix). */
export const RELEASE_COMMANDS: Record<string, string> = {
	"add-reference": "Add reference",
	"insert-citation": "Insert citation",
	"copy-formatted-citation": "Copy formatted citation for current reference",
	"check-library-health": "Check library health",
	"review-duplicates": "Review duplicate references",
	"batch-edit": "Batch edit references",
	"create-library-base": "Create library base",
	"find-pdf": "Find PDF for current reference",
	"import-bibliography": "Import bibliography file (CSL-JSON, BibTeX, RIS)",
};

/** Commands of the reading round trip, which needs the desktop file system. */
export const ROUND_TRIP_COMMANDS = ["send-to-tablet", "check-tablet-folder"];

/**
 * Put the vault files back to the fixture vault (plus extra files), close dialogs, reset the
 * network stub and Stacks' settings to what they were when the spec started, and make sure
 * the stub answers Stacks' requests.
 */
export async function resetLibrary(extra: Record<string, string | ArrayBuffer> = {}): Promise<void> {
	await closeModals();
	await clearNotices();
	await browser.executeObsidian(({ app }) => {
		app.workspace.getLeavesOfType("markdown").forEach((l) => l.detach());
		app.workspace.getLeavesOfType("bases").forEach((l) => l.detach());
	});
	await obsidianPage.resetVault(VAULT, extra);
	await browser.executeObsidian(async ({ app }, stubId) => {
		const plugins = (app as any).plugins.plugins;
		const stacks = plugins.stacks;
		const w = window as any;
		// The settings the plugin loaded with, kept once per Obsidian session.
		w.__stacksE2eSettings ??= JSON.stringify(stacks.settings);
		stacks.settings = JSON.parse(w.__stacksE2eSettings);
		await stacks.saveSettings();
		plugins[stubId].reset();
		if (!plugins[stubId].install()) throw new Error("Stacks isn't loaded");
	}, STUB_ID);
	// Let Obsidian index the reset files before a test reads the metadata cache.
	await waitForIndex();
}

/** Wait until the metadata cache has caught up with the vault. */
export async function waitForIndex(): Promise<void> {
	await browser.executeObsidian(
		({ app }) =>
			new Promise<void>((resolve) => {
				const cache = app.metadataCache as any;
				if (!cache.resolved && cache.inProgressTaskCount !== 0) {
					const ref = app.metadataCache.on("resolved", () => {
						app.metadataCache.offref(ref);
						resolve();
					});
				} else resolve();
			})
	);
	await browser.pause(300);
}

/** Close every open modal. */
export async function closeModals(): Promise<void> {
	await browser.executeObsidian(() => {
		for (const el of Array.from(document.querySelectorAll(".modal-container .modal-close-button"))) (el as HTMLElement).click();
	});
	await browser.waitUntil(async () => (await browser.$$(".modal-container").length) === 0, { timeoutMsg: "a modal stayed open" });
}

export async function runCommand(id: string): Promise<void> {
	await browser.executeObsidianCommand(`stacks:${id}`);
}

/** Open a vault file in the active tab and wait until it is the active file. */
export async function openFile(path: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, p) => {
		const file = app.vault.getFileByPath(p);
		if (!file) throw new Error(`no file ${p}`);
		await app.workspace.getLeaf(false).openFile(file);
	}, path);
	await browser.waitUntil(async () => (await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path)) === path, {
		timeoutMsg: `${path} didn't open`,
	});
}

/** Paths of the vault's files (not folders), sorted, optionally only under a folder. */
export async function files(folder = ""): Promise<string[]> {
	return browser.executeObsidian(
		({ app }, f) =>
			app.vault
				.getFiles()
				.map((x) => x.path)
				.filter((p) => !f || p.startsWith(`${f}/`))
				.sort(),
		folder
	);
}

/** Wait until files(folder) satisfies the predicate; returns the last listing. */
export async function waitForFiles(folder: string, ok: (paths: string[]) => boolean, timeoutMsg: string, timeout = 20000): Promise<string[]> {
	let last: string[] = [];
	await browser.waitUntil(
		async () => {
			last = await files(folder);
			return ok(last);
		},
		{ timeout, timeoutMsg: `${timeoutMsg} (files in ${folder || "vault"}: ${JSON.stringify(last)})` }
	);
	return last;
}

/** The frontmatter Obsidian has indexed for a file, or null. */
export async function frontmatter(path: string): Promise<Record<string, unknown> | null> {
	return browser.executeObsidian(({ app }, p) => {
		const file = app.vault.getFileByPath(p);
		return file ? (app.metadataCache.getFileCache(file)?.frontmatter ?? null) : null;
	}, path);
}

export async function read(path: string): Promise<string> {
	return browser.executeObsidian(async ({ app }, p) => {
		const file = app.vault.getFileByPath(p);
		if (!file) throw new Error(`no file ${p}`);
		return app.vault.read(file);
	}, path);
}

/** Dismiss every notice on screen, so a later wait can't match an old one. */
export async function clearNotices(): Promise<void> {
	await browser.executeObsidian(() => document.querySelectorAll(".notice").forEach((n) => n.remove()));
}

/** Texts of the notices on screen now. */
export async function notices(): Promise<string[]> {
	return browser.executeObsidian(() => Array.from(document.querySelectorAll(".notice")).map((n) => n.textContent ?? ""));
}

/** Wait for a notice containing text; returns its full text. */
export async function waitForNotice(text: string | RegExp, timeout = 15000): Promise<string> {
	let found = "";
	let seen: string[] = [];
	await browser.waitUntil(
		async () => {
			seen = await notices();
			found = seen.find((n) => (typeof text === "string" ? n.includes(text) : text.test(n))) ?? "";
			return !!found;
		},
		{ timeout, timeoutMsg: `no notice matching ${String(text)} (notices: ${JSON.stringify(seen)})` }
	);
	return found;
}

/** The network stub's record: every URL requested, and those it had no fixture for. */
export async function stubLog(): Promise<{ requests: string[]; unmatched: string[] }> {
	return browser.executeObsidian(({ app }, id) => {
		const stub = (app as any).plugins.plugins[id];
		return { requests: [...stub.requests], unmatched: [...stub.unmatched] };
	}, STUB_ID);
}

export async function setOffline(offline: boolean): Promise<void> {
	await browser.executeObsidian(({ app }, id, value) => ((app as any).plugins.plugins[id].offline = value), STUB_ID, offline);
}

/** Change Stacks settings in the running plugin (and save them). */
export async function setSettings(values: Record<string, unknown>): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, v) => {
			const stacks = (app as any).plugins.plugins.stacks;
			Object.assign(stacks.settings, v);
			await stacks.saveSettings();
		},
		values
	);
}

/** A Web Clipper note as it lands in the inbox. */
export function clipNote(title: string, url: string, extra = ""): string {
	return `---\ntitle: "${title}"\nsource: ${url}\ncreated: 2026-11-01\ntags:\n  - clippings\n${extra}---\n\nClipped text of ${title}.\n`;
}

/** Errors Stacks logged to the console since the last call (console.error is wrapped once). */
export async function takeConsoleErrors(): Promise<string[]> {
	return browser.executeObsidian(() => {
		const w = window as any;
		if (!w.__stacksE2eErrors) {
			w.__stacksE2eErrors = [];
			const original = console.error.bind(console);
			console.error = (...args: unknown[]) => {
				w.__stacksE2eErrors.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "));
				original(...args);
			};
		}
		return w.__stacksE2eErrors.splice(0);
	});
}

/**
 * Write a file into the open vault from outside Obsidian, as a sync client or a file manager
 * would: straight to disk, so Obsidian only learns of it through its file watcher.
 */
export async function syncWrite(path: string, content: string | Uint8Array): Promise<void> {
	const full = join(obsidianPage.getVaultPath(), path);
	await mkdir(dirname(full), { recursive: true });
	await writeFile(full, content);
}

/** Append to a file in the vault from outside Obsidian. */
export async function syncAppend(path: string, content: Uint8Array): Promise<void> {
	await appendFile(join(obsidianPage.getVaultPath(), path), content);
}

/** Read a vault file from disk, from outside Obsidian. */
export async function diskRead(path: string): Promise<Buffer> {
	return readFile(join(obsidianPage.getVaultPath(), path));
}

/** Reference notes (by path) whose indexed doi property is the given DOI. */
export async function notesWithDoi(doi: string): Promise<string[]> {
	return browser.executeObsidian(
		({ app }, d) =>
			app.vault
				.getMarkdownFiles()
				.filter((f) => f.path.startsWith("References/") && String(app.metadataCache.getFileCache(f)?.frontmatter?.doi ?? "").toLowerCase() === d)
				.map((f) => f.path)
				.sort(),
		doi.toLowerCase()
	);
}

/**
 * What Stacks wrote to the clipboard since the last call. navigator.clipboard is replaced in
 * this Obsidian window by a recorder: the system clipboard is shared by all the Obsidian
 * windows the tests run side by side, and only takes HTML from the focused one, so reading it
 * back would test the window manager rather than Stacks.
 */
export async function takeClipboardWrites(): Promise<{ text: string; html?: string }[]> {
	return browser.executeObsidian(() => {
		const w = window as any;
		if (!w.__stacksE2eClipboard) {
			const log: Promise<{ text: string; html?: string }>[] = [];
			w.__stacksE2eClipboard = log;
			const blobText = async (item: ClipboardItem, type: string) => (item.types.includes(type) ? (await item.getType(type)).text() : undefined);
			navigator.clipboard.write = async (items: ClipboardItem[]) => {
				for (const item of items) log.push(Promise.all([blobText(item, "text/plain"), blobText(item, "text/html")]).then(([text, html]) => ({ text: text ?? "", html })));
			};
			navigator.clipboard.writeText = async (text: string) => {
				log.push(Promise.resolve({ text }));
			};
		}
		return Promise.all(w.__stacksE2eClipboard.splice(0));
	});
}
