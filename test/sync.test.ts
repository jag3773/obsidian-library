// Offline capture, sync-safe filing, startup inbox processing and batch edits (#27, #30),
// against the in-memory Obsidian stand-in in test/mocks/obsidian.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App, Notice, TFile, http, parseYaml, pdf } from "obsidian";
import { BatchActions } from "../src/batchActions";
import { Inbox } from "../src/inbox";
import { Cancelled, Library } from "../src/library";
import { runBatch } from "../src/batch";
import { looksComplete } from "../src/sync";
import { buildPdf } from "./pdf-fixture";
import LibraryPlugin from "../src/main";
import { LibrarySettings, withDefaults } from "../src/settings";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function flush(rounds = 20) {
	for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

const fetcher = async (url: string, headers?: Record<string, string>) => (await import("obsidian")).requestUrl({ url, headers });

function setup(overrides: Partial<LibrarySettings> = {}) {
	const app = new App();
	const settings = withDefaults(overrides);
	const library = new Library(app as any, () => settings);
	const inbox = new Inbox(app as any, library, fetcher, () => settings);
	const batch = new BatchActions(app as any, library, () => settings, fetcher, () => undefined);
	http.calls = [];
	http.handler = async () => ({ status: 404, text: "" });
	Notice.messages = [];
	return { app, settings, library, inbox, batch };
}

async function setupPlugin(app: App, overrides: Partial<LibrarySettings> = {}) {
	const plugin = new LibraryPlugin(app as any, { id: "stacks" } as any);
	(plugin as any).data = overrides;
	await plugin.onload();
	return plugin;
}

const fm = (app: App, f: TFile) => app.metadataCache.getFileCache(f)?.frontmatter ?? {};
const offline = async (): Promise<never> => {
	throw new Error("net::ERR_INTERNET_DISCONNECTED");
};

function crossref(doi: string, title: string) {
	http.handler = async ({ url }) =>
		url.includes(encodeURIComponent(doi))
			? {
					status: 200,
					text: JSON.stringify({
						message: { type: "journal-article", title: [title], author: [{ given: "Ada", family: "Lovelace" }], issued: { "date-parts": [[1843]] }, DOI: doi },
					}),
				}
			: { status: 404, text: "" };
}

function pdfWithText(text: string) {
	pdf.impl = {
		getDocument: () => ({
			promise: Promise.resolve({
				numPages: 1,
				getPage: async () => ({ getTextContent: async () => ({ items: [{ str: text }] }) }),
				getMetadata: async () => ({ info: {} }),
				destroy: async () => undefined,
			}),
		}),
	};
}

// ---------------------------------------------------------------- offline capture

test("#30 a clip whose lookup gets no answer stays in the inbox, then files once online", async () => {
	const { app, inbox } = setup();
	const clip = app.vault.addFile("Inbox/clip.md", `---\n{"url":"https://example.com/offline","title":"Offline Thing"}\n---\n`);
	http.handler = offline;
	assert.equal(await inbox.process(clip), null);
	assert.equal(clip.path, "Inbox/clip.md", "not moved");
	assert.deepEqual(fm(app, clip), { url: "https://example.com/offline", title: "Offline Thing" }, "not half-processed");
	assert.ok(Notice.messages.some((m) => /couldn't reach the network/.test(m)));
	assert.equal(app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("References/")).length, 0);

	http.handler = async () => ({ status: 200, text: "<title>Offline Thing</title>" });
	assert.ok(await inbox.process(clip));
	assert.ok(clip.path.startsWith("References/"));
});

test("#30 a PDF naming a DOI stays in the inbox while offline", async () => {
	const { app, inbox } = setup();
	pdfWithText("doi:10.1000/off");
	const file = app.vault.addFile("Inbox/scan.pdf", "%PDF off\nstartxref\n0\n%%EOF");
	http.handler = offline;
	assert.equal(await inbox.process(file), null);
	assert.equal(file.path, "Inbox/scan.pdf");
	assert.equal(app.vault.getMarkdownFiles().length, 0, "no note created from the filename");

	crossref("10.1000/off", "Online Again");
	assert.ok(await inbox.process(file));
	assert.ok(file.path.startsWith("References/attachments/"));
});

test("#30 control: a PDF with no identifier is filed offline (no lookup needed)", async () => {
	const { app, inbox } = setup();
	pdfWithText("just some text");
	const file = app.vault.addFile("Inbox/notes.pdf", "%PDF none\nstartxref\n0\n%%EOF");
	http.handler = offline;
	assert.ok(await inbox.process(file));
	assert.equal(http.calls.length, 0);
});

// ---------------------------------------------------------------- PDFs still arriving

test("#30 looksComplete: a PDF ends with startxref and %%EOF in its last 1024 bytes", () => {
	const enc = (t: string) => new TextEncoder().encode(t);
	assert.equal(looksComplete(enc("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\nstartxref\n9\n%%EOF\n")), true);
	assert.equal(looksComplete(enc("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\nstartxref\r\n9\r\n%%EOF")), true, "CR LF line ends");
	assert.equal(looksComplete(enc("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrai")), false, "cut off before the end");
	// Linearized PDFs have an early %%EOF; only the end of the file counts.
	assert.equal(looksComplete(enc("%PDF-1.7\nstartxref\n0\n%%EOF\n" + "x".repeat(2000))), false);
	assert.equal(looksComplete(enc("%PDF-1.7\nstartxref\n9\n%%EOF\n" + " ".repeat(500))), true, "trailing whitespace after %%EOF is fine");
	assert.equal(looksComplete(enc("%PDF-1.7\nstartxref\n9\n%%EOF\nmore")), false, "%%EOF must be the end of the file");
	assert.equal(looksComplete(new Uint8Array()), false);
});

test("#30 looksComplete: the text %%EOF inside a cut-off PDF's content doesn't count", () => {
	// A whole PDF whose page says "%%EOF", cut off partway through, after that text.
	const whole = buildPdf([{ text: [{ x: 72, y: 700, text: "This page mentions %%EOF in its text" }] }]);
	const at = new TextDecoder("latin1").decode(whole).indexOf("%%EOF in its text");
	assert.ok(at > 0, "the fixture has the text");
	assert.equal(looksComplete(whole), true, "the whole file is complete");
	assert.equal(looksComplete(whole.subarray(0, at + 40)), false, "a prefix ending after the text isn't");
});

test("#30 a PDF still being written is left in the inbox, and filed once it is complete", async () => {
	const { app, inbox } = setup();
	pdfWithText("doi:10.1000/partial");
	crossref("10.1000/partial", "Partial Arrival");
	const file = app.vault.addFile("Inbox/partial.pdf", "%PDF-1.7\n1 0 obj");
	assert.equal(await inbox.process(file), null);
	assert.equal(file.path, "Inbox/partial.pdf", "not filed under its filename");
	assert.equal(app.vault.getMarkdownFiles().length, 0);
	assert.equal(http.calls.length, 0, "not even looked up");
	assert.ok(Notice.messages.some((m) => /partial\.pdf looks incomplete/.test(m)));

	await app.vault.modifyBinary(file, new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n").buffer as ArrayBuffer);
	assert.ok(await inbox.process(file));
	assert.ok(file.path.startsWith("References/attachments/"));
});

test("#30 Process inbox now files a PDF that looks incomplete as it is", async () => {
	const { app, inbox } = setup();
	pdfWithText("no identifier");
	const file = app.vault.addFile("Inbox/odd.pdf", "%PDF-1.4 written by a tool that leaves out %%EO");
	assert.ok(await inbox.process(file, true));
	assert.ok(file.path.startsWith("References/attachments/"));
});

test("#30 an inbox PDF that finishes arriving after it was left as incomplete is processed automatically", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const app = new App();
	http.calls = [];
	Notice.messages = [];
	pdfWithText("doi:10.1000/slow");
	crossref("10.1000/slow", "Slow Copy");
	const plugin = await setupPlugin(app);
	await flush();
	const file = await app.vault.createBinary("Inbox/slow.pdf", new TextEncoder().encode("%PDF-1.7\n1 0 obj").buffer as ArrayBuffer);
	t.mock.timers.tick(1000);
	await flush();
	assert.equal(file.path, "Inbox/slow.pdf");
	assert.ok(Notice.messages.some((m) => /slow\.pdf looks incomplete/.test(m)));

	// The rest arrives. Each change restarts the settle time.
	await app.vault.modifyBinary(file, new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>").buffer as ArrayBuffer);
	t.mock.timers.tick(500);
	await app.vault.modifyBinary(file, new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n").buffer as ArrayBuffer);
	t.mock.timers.tick(500);
	await flush();
	assert.equal(file.path, "Inbox/slow.pdf", "still settling");
	// The settle time is over, but the first attempt only just finished: it looks again once that settles too.
	t.mock.timers.tick(500);
	await flush();
	t.mock.timers.tick(1000);
	await flush();
	assert.ok(file.path.startsWith("References/attachments/"), file.path);
	assert.equal(app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("References/")).length, 1, "filed once");
	plugin.unload();
});

// ---------------------------------------------------------------- idempotent filing

test("#30 a synced-in note the cache hasn't indexed still counts as a duplicate", async () => {
	const { app, inbox } = setup();
	const other = app.vault.addFile("References/fromOtherDevice.md", `---\n{"citekey":"fromOtherDevice","url":"https://example.com/same"}\n---\n`);
	app.metadataCache.cache.delete(other); // arrived through sync, not indexed yet
	const clip = app.vault.addFile("Inbox/clip.md", `---\n{"url":"https://example.com/same","title":"Same"}\n---\n`);
	http.handler = async () => ({ status: 200, text: "<title>Same</title>" });
	assert.equal(await inbox.process(clip), null);
	assert.equal(clip.path, "Inbox/clip.md");
	assert.ok(Notice.messages.some((m) => m.includes("matches existing fromOtherDevice")));
});

test("#30 Add reference finds an unindexed note with the same DOI instead of creating another", async () => {
	const app = new App();
	const plugin = await setupPlugin(app);
	const other = app.vault.addFile("References/synced.md", `---\n{"citekey":"synced","doi":"10.1000/dup"}\n---\n`);
	app.metadataCache.cache.delete(other);
	crossref("10.1000/dup", "Dup Paper");
	await plugin.addByIdentifier("10.1000/dup");
	await flush();
	assert.equal(app.vault.getMarkdownFiles().length, 1);
	assert.ok(Notice.messages.some((m) => /already in your library as synced/.test(m)));
	plugin.unload();
});

test("#30 an identical PDF that is already filed isn't filed a second time", async () => {
	const { app, inbox } = setup();
	app.vault.addFile("References/lovelaceOnlinePaper1843.md", `---\n{"citekey":"lovelaceOnlinePaper1843","doi":"10.1000/twice","pdf":"[[lovelaceOnlinePaper1843.pdf]]"}\n---\n`);
	const filed = app.vault.addFile("References/attachments/lovelaceOnlinePaper1843.pdf", "%PDF same bytes\nstartxref\n0\n%%EOF");
	pdfWithText("doi:10.1000/twice");
	crossref("10.1000/twice", "Online Paper");
	const copy = app.vault.addFile("Inbox/copy.pdf", "%PDF same bytes\nstartxref\n0\n%%EOF");
	assert.equal(await inbox.process(copy), null);
	assert.equal(copy.path, "Inbox/copy.pdf", "left where it is, nothing overwritten");
	assert.equal(app.vault.getAbstractFileByPath("References/attachments/lovelaceOnlinePaper1843 1.pdf"), null);
	assert.ok(Notice.messages.some((m) => m.includes(`already filed as ${filed.path}`)));
});

test("#30 control: a different PDF for the same reference is still attached", async () => {
	const { app, inbox } = setup();
	app.vault.addFile("References/lovelaceOnlinePaper1843.md", `---\n{"citekey":"lovelaceOnlinePaper1843","doi":"10.1000/twice"}\n---\n`);
	app.vault.addFile("References/attachments/lovelaceOnlinePaper1843.pdf", "%PDF version one\nstartxref\n0\n%%EOF");
	pdfWithText("doi:10.1000/twice");
	crossref("10.1000/twice", "Online Paper");
	const v2 = app.vault.addFile("Inbox/v2.pdf", "%PDF version two\nstartxref\n0\n%%EOF");
	assert.ok(await inbox.process(v2));
	assert.equal(v2.path, "References/attachments/lovelaceOnlinePaper1843 1.pdf");
});

// ---------------------------------------------------------------- startup

test("#30 files already in the inbox are processed shortly after startup", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const app = new App();
	http.calls = [];
	http.handler = async () => ({ status: 200, text: "<title>While Closed</title>" });
	const clip = app.vault.addFile("Inbox/while-closed.md", `---\n{"url":"https://example.com/closed"}\n---\n`);
	const plugin = await setupPlugin(app);
	await flush();
	assert.equal(clip.path, "Inbox/while-closed.md", "waits for sync and indexing first");
	t.mock.timers.tick(5000);
	await flush();
	assert.ok(clip.path.startsWith("References/"));
	plugin.unload();
});

test("#30 control: with automatic processing off, startup leaves the inbox alone", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const app = new App();
	http.calls = [];
	const clip = app.vault.addFile("Inbox/while-closed.md", `---\n{"url":"https://example.com/closed"}\n---\n`);
	const plugin = await setupPlugin(app, { processInboxAutomatically: false });
	t.mock.timers.tick(10000);
	await flush();
	assert.equal(clip.path, "Inbox/while-closed.md");
	assert.equal(http.calls.length, 0);
	plugin.unload();
});

// ---------------------------------------------------------------- batch edits

function library3(app: App) {
	return ["a", "b", "c"].map((k, i) =>
		app.vault.addFile(`References/${k}.md`, `---\n${JSON.stringify({ citekey: k, title: `Title ${k}`, status: i === 0 ? "reading" : "queued" })}\n---\nbody ${k}\n`)
	);
}

test("#27 the preview counts what a batch changes and why the rest is left alone", () => {
	const { app, batch } = setup();
	const files = library3(app);
	const outside = app.vault.addFile("Projects/plan.md", "");
	const plan = batch.plan([...files, outside], { kind: "status", value: "reading" });
	assert.deepEqual(plan.todo.map((f) => f.basename), ["b", "c"]);
	assert.deepEqual(
		plan.skipped.map((s) => [s.item.basename, s.skip]),
		[
			["a", "already reading"],
			["plan", "not in the references folder"],
		]
	);
});

test("#27 set status and collections on many notes, through the frontmatter API only", async () => {
	const { app, batch } = setup({ propertyNames: { ...withDefaults({}).propertyNames, collections: "topics" } });
	const files = library3(app);
	for (const f of files) assert.equal(await batch.apply(f, { kind: "add-collection", link: "[[Climate]]" }), true);
	assert.equal(await batch.apply(files[0], { kind: "add-collection", link: "[[climate]]" }), false, "already there");
	await batch.apply(files[1], { kind: "status", value: "processed" });
	await flush();
	assert.deepEqual(fm(app, files[0]).topics, ["[[Climate]]"]);
	assert.equal(fm(app, files[1]).status, "processed");
	assert.match(await app.vault.read(files[2]), /body c/, "bodies are untouched");
	assert.equal(await batch.apply(files[2], { kind: "remove-collection", link: "[[Climate]]" }), true);
	await flush();
	assert.deepEqual(fm(app, files[2]).topics, []);
});

test("#27 a collection link that resolves to the same note counts as the same collection", async () => {
	const { app, batch } = setup();
	app.vault.addFile("Topics/Climate.md", "");
	const f = app.vault.addFile("References/x.md", `---\n{"citekey":"x","collections":["[[Topics/Climate]]"]}\n---\n`);
	assert.equal(batch.skipReason(f, { kind: "add-collection", link: "[[Climate]]" }), "already in Climate");
});

test("#27 regenerating citekeys renames notes and reports per-item errors", async () => {
	const { app, library, batch } = setup({ citekeyPattern: "auth.lower + year" });
	const f = app.vault.addFile("References/old.md", `---\n{"citekey":"old","title":"T","authors":["Ada Lovelace"],"year":1843}\n---\n`);
	const gone = app.vault.addFile("References/gone.md", `---\n{"citekey":"gone","title":"G"}\n---\n`);
	app.vault.delete(gone);
	assert.equal(await batch.apply(f, { kind: "regenerate-citekey" }), true);
	assert.equal(f.path, "References/lovelace1843.md");
	await assert.rejects(batch.apply(gone, { kind: "regenerate-citekey" }), /no longer in the vault/);
	assert.ok(library);
});

test("#27 completing metadata reports an offline lookup as an error for that note", async () => {
	const { app, batch } = setup();
	const f = app.vault.addFile("References/draft.md", `---\n{"doi":"10.1000/batch"}\n---\n`);
	http.handler = offline;
	await assert.rejects(batch.apply(f, { kind: "complete" }), /couldn't reach the network/);
	crossref("10.1000/batch", "Batch Paper");
	assert.equal(await batch.apply(f, { kind: "complete" }), true);
	assert.equal(f.path, "References/lovelaceBatchPaper1843.md");
	const empty = app.vault.addFile("References/empty.md", "");
	assert.equal(batch.skipReason(empty, { kind: "complete" }), "no ISBN, DOI, URL or title");
});

test("#27 unloading after the first item of a status batch leaves the second note unchanged", async () => {
	const app = new App();
	const settings = withDefaults({});
	let alive = true;
	const library = new Library(app as any, () => settings, () => alive);
	const batch = new BatchActions(app as any, library, () => settings, fetcher, () => undefined);
	const [, b, c] = library3(app);
	const result = await runBatch(
		[b, c],
		async (f) => {
			const changed = await batch.apply(f, { kind: "status", value: "processed" });
			alive = false; // The plugin is disabled once the first note is written.
			return changed;
		},
		{},
		(e) => e instanceof Cancelled
	);
	await flush();
	assert.equal(fm(app, b).status, "processed");
	assert.equal(fm(app, c).status, "queued", "no write after unload");
	assert.equal(result.cancelled, true);
	assert.deepEqual(result.notRun, [c]);

	// Unloaded while processFrontMatter is pending: the callback refuses to write.
	alive = true;
	const pending = batch.apply(c, { kind: "add-collection", link: "[[Climate]]" });
	alive = false;
	await assert.rejects(pending, Cancelled);
	await flush();
	assert.equal(fm(app, c).collections, undefined);
});

test("#27 a batch completion skips a note whose identifier changed during the lookup", async () => {
	const { app, batch } = setup();
	const f = app.vault.addFile("References/draft.md", `---\n{"doi":"10.1000/old"}\n---\n`);
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	crossref("10.1000/old", "Old Paper");
	const answer = http.handler;
	http.handler = async (p) => {
		await gate;
		return answer(p);
	};
	const pending = batch.apply(f, { kind: "complete" });
	await flush();
	// The person corrects the DOI while the lookup is pending.
	app.vault.write(f, `---\n{"doi":"10.1000/new"}\n---\n`);
	await flush();
	release();
	await assert.rejects(pending, /changed during lookup/);
	await flush();
	assert.equal(f.path, "References/draft.md", "not renamed");
	assert.deepEqual(fm(app, f), { doi: "10.1000/new" }, "not filled from the old DOI");
});

// ---------------------------------------------------------------- library base command

test("#27 Create library base writes a new file and never overwrites one", async () => {
	const app = new App();
	const plugin = await setupPlugin(app);
	app.vault.addFile("Library.base", "mine: true\n");
	const cmd = (plugin as any).commands.find((c: any) => c.id === "create-library-base");
	cmd.callback();
	await flush();
	const created = app.vault.getAbstractFileByPath("Library 1.base") as TFile;
	assert.ok(created);
	assert.equal(await app.vault.read(app.vault.getAbstractFileByPath("Library.base") as TFile), "mine: true\n");
	const config = parseYaml(await app.vault.read(created));
	assert.deepEqual(
		config.views.map((v: any) => v.name),
		["Library", "Queued", "Reading", "Reviewing", "Processed", "Shelved", "Unfiled", "Missing PDF"]
	);
	assert.equal(plugin.settings.libraryBase, "Library 1.base", "adopted when none was set");
	cmd.callback();
	await flush();
	assert.ok(app.vault.getAbstractFileByPath("Library 2.base"));
	assert.equal(plugin.settings.libraryBase, "Library 1.base", "an existing choice is kept");
	plugin.unload();
});

test("#27 the Stacks batch view is registered for Bases", async () => {
	const app = new App();
	const plugin = await setupPlugin(app);
	const reg = (plugin as any).basesViews.get("stacks-batch");
	assert.ok(reg);
	assert.equal(reg.name, "Stacks batch");
	assert.equal(typeof reg.factory, "function");
	plugin.unload();
});

// ---------------------------------------------------------------- mobile

test("#30 on mobile the tablet round trip and external commands are off, quietly", async () => {
	const app = new App(); // the stand-in's Platform.isDesktopApp is false, as on mobile
	const plugin = await setupPlugin(app, { tabletFolder: "/Users/me/Dropbox/Books", preExtractionCommand: "echo {in} {out}" });
	assert.equal(plugin.roundTrip, null);
	assert.equal((plugin as any).host, null);
	const note = app.vault.addFile("References/r.md", `---\n{"citekey":"r","status":"queued"}\n---\n`);
	app.workspace.active = note;
	for (const id of ["send-to-tablet", "check-tablet-folder"]) {
		const cmd = (plugin as any).commands.find((c: any) => c.id === id);
		assert.equal(cmd.checkCallback(true), false, `${id} is hidden`);
	}
	await plugin.sendToTablet(note, true);
	await app.fileManager.processFrontMatter(note, (d) => (d.status = "reading"));
	await flush();
	assert.ok(!Notice.messages.some((m) => /tablet/i.test(m)), "no errors about the tablet folder");
	plugin.unload();
});
