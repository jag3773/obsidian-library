// Annotation extraction into notes and the tablet round trip, against the in-memory vault,
// the real PDF.js and a real temporary "tablet" folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as cp from "node:child_process";
// @ts-expect-error: pdfjs-dist ships .d.mts types that this tsconfig doesn't resolve; tests only.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { App, Notice, TFile, pdf } from "obsidian";
import { END_MARKER, START_MARKER } from "../src/annotations";
import { nodeHost } from "../src/desktop";
import { Extractor } from "../src/extract";
import { Cancelled, Library } from "../src/library";
import LibraryPlugin from "../src/main";
import { ConflictChoice, ConflictInfo, Host, RoundTrip, classifyReturn, toArrayBuffer } from "../src/roundtrip";
import { LibrarySettings, withDefaults } from "../src/settings";
import { buildPdf, lineQuad } from "./pdf-fixture";

/* eslint-disable @typescript-eslint/no-explicit-any */

pdf.impl = pdfjs;

const TEXT = [
	{ x: 72, y: 700, text: "A sentence worth keeping." },
	{ x: 72, y: 600, text: "Another one for later." },
];
const CLEAN = buildPdf([{ text: TEXT }]);
const HIGHLIGHTED = buildPdf([
	{
		text: TEXT,
		annots: [
			{ subtype: "Highlight", rect: [72, 695, 300, 712], quads: lineQuad(72, 300, 700), color: [1, 0.83, 0], contents: "Key point" },
			{ subtype: "Highlight", rect: [72, 595, 300, 612], quads: lineQuad(72, 300, 600), color: [0.37, 0.7, 0.21] },
		],
	},
]);
const ONE_HIGHLIGHT = buildPdf([{ text: TEXT, annots: [{ subtype: "Underline", rect: [72, 595, 300, 612], quads: lineQuad(72, 300, 600), color: [1, 0.4, 0.4] }] }]);

const modules = { fs, path, os, cp };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function flush(rounds = 20) {
	for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}
async function until(cond: () => boolean, ms = 3000) {
	const end = Date.now() + ms;
	while (!cond()) {
		if (Date.now() > end) throw new Error("timed out");
		await sleep(10);
	}
}

const NOTE = "References/smith2020.md";
const PDF = "References/attachments/smith2020.pdf";

function vaultWithReference(app: App, status = "reading", body = "# Smith\n\nMy own thoughts.\n\n## Annotations\n\nWritten under the heading by me.\n") {
	const note = app.vault.addFile(NOTE, `---\n${JSON.stringify({ citekey: "smith2020", status, pdf: "[[smith2020.pdf]]" })}\n---\n${body}`);
	const file = app.vault.addFile(PDF, toArrayBuffer(CLEAN));
	return { note, file };
}

function tempFolder(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "stacks-tablet-test-"));
}

function setup(overrides: Partial<LibrarySettings> = {}, wrapHost: (host: Host, app: App) => Host = (h) => h) {
	const app = new App();
	const tablet = tempFolder();
	const settings = withDefaults({ tabletFolder: tablet, ...overrides });
	const library = new Library(app as any, () => settings);
	const extractor = new Extractor(app as any, library, () => settings);
	const ui = {
		notices: [] as string[],
		conflicts: [] as ConflictInfo[],
		choice: "later" as ConflictChoice,
		notice(m: string) {
			this.notices.push(m);
		},
		/** Runs while the dialog is open, to change things under it. */
		whileOpen: async () => undefined as void,
		async conflict(info: ConflictInfo) {
			this.conflicts.push(info);
			await this.whileOpen();
			return this.choice;
		},
	};
	const rt = new RoundTrip(app as any, library, extractor, () => settings, async () => undefined, wrapHost(nodeHost(app as any, modules), app), ui);
	rt.settleMs = 5;
	const { note, file } = vaultWithReference(app);
	return { app, settings, library, extractor, ui, rt, tablet, note, file };
}

const content = (app: App, f: TFile) => String(app.vault.contents.get(f));
const fm = (app: App, f: TFile) => (app.metadataCache.getFileCache(f)?.frontmatter ?? {}) as Record<string, unknown>;
const bytesOf = (app: App, f: TFile) => new Uint8Array(app.vault.contents.get(f) as ArrayBuffer);

/** Replace the tablet copy, with an mtime clearly after the last sync. */
function tabletWrite(file: string, data: Uint8Array) {
	fs.writeFileSync(file, data);
	const t = new Date(Date.now() + 5000);
	fs.utimesSync(file, t, t);
}

// ---------------------------------------------------------------- extraction into notes

test("extraction writes the block under the heading, sets the count and date, and keeps the user's text", async () => {
	const { app, extractor, note, file } = setup();
	app.vault.contents.set(file, toArrayBuffer(HIGHLIGHTED));
	const r = await extractor.extract(note);
	await flush();
	assert.equal(r.count, 2);
	assert.equal(r.changed, true);
	const text = content(app, note);
	assert.match(text, /My own thoughts\./);
	assert.match(text, /Written under the heading by me\./);
	assert.match(text, new RegExp(`## Annotations\\n\\n${START_MARKER}\\n### Page 1\\n`));
	assert.match(text, /> \[!quote\] Quote · \[\[smith2020\.pdf#page=1\|p\. 1\]\]\n> A sentence worth keeping\.\n>\n> > \[!note\] Comment\n> > Key point/);
	assert.match(text, /> \[!tip\] Follow up · \[\[smith2020\.pdf#page=1\|p\. 1\]\]\n> Another one for later\./);
	assert.ok(text.indexOf(END_MARKER) < text.indexOf("Written under the heading by me."));
	assert.equal(fm(app, note).highlights, 2);
	assert.equal(fm(app, note).last_highlighted, "2026-11-08");

	// Again with nothing new: nothing is written.
	const before = content(app, note);
	const again = await extractor.extract(note);
	assert.equal(again.changed, false);
	assert.equal(content(app, note), before);

	// Highlights removed in the PDF: their entries go, the user's text stays.
	app.vault.contents.set(file, toArrayBuffer(ONE_HIGHLIGHT));
	const fewer = await extractor.extract(note);
	await flush();
	assert.equal(fewer.count, 1);
	assert.doesNotMatch(content(app, note), /A sentence worth keeping/);
	assert.match(content(app, note), /Written under the heading by me\./);
	assert.equal(fm(app, note).highlights, 1);
});

test("status after extraction only moves forward", async () => {
	const { app, settings, extractor, note, file } = setup({ statusAfterExtraction: "processed" });
	app.vault.contents.set(file, toArrayBuffer(HIGHLIGHTED));
	await extractor.extract(note);
	await flush();
	assert.equal(fm(app, note).status, "processed");

	await app.fileManager.processFrontMatter(note, (f: any) => (f.status = "shelved"));
	await flush();
	settings.colorMap = "default: quote"; // a different rendering, so it writes again
	await extractor.extract(note);
	await flush();
	assert.equal(fm(app, note).status, "shelved", "shelved comes after processed");
});

test("a PDF with no annotations leaves a note without a block untouched", async () => {
	const { app, extractor, note } = setup();
	const before = content(app, note);
	const r = await extractor.extract(note);
	assert.equal(r.count, 0);
	assert.equal(content(app, note), before);
});

test("a note without a PDF gets a clear error", async () => {
	const { app, extractor } = setup();
	const bare = app.vault.addFile("References/bare.md", `---\n{"citekey":"bare"}\n---\n`);
	await assert.rejects(extractor.extract(bare), /has no PDF linked/);
});

// ---------------------------------------------------------------- round trip

test("classifying a returned copy", () => {
	const rec = { vaultHash: "v", externalHash: "e" };
	assert.equal(classifyReturn(rec, "e", "v"), "unchanged");
	assert.equal(classifyReturn(rec, "e2", "v"), "returned");
	assert.equal(classifyReturn(rec, "e2", "v2"), "conflict");
	assert.equal(classifyReturn(rec, "same", "same"), "unchanged", "both changed to the same content");
});

test("send, return with highlights, bring back, set status, extract", async () => {
	const { app, settings, rt, tablet, note, file, ui } = setup();
	assert.match(await rt.send(note), /sent smith2020\.pdf/);
	const there = path.join(tablet, "smith2020.pdf");
	assert.deepEqual(new Uint8Array(fs.readFileSync(there)), CLEAN);
	assert.equal(settings.tabletSent["smith2020.pdf"].attachment, PDF);
	assert.match(await rt.send(note), /already in the tablet folder/);

	assert.equal(await rt.checkAll(), 0, "nothing changed yet");

	tabletWrite(there, HIGHLIGHTED);
	assert.equal(await rt.checkAll(), 1);
	await flush();
	assert.deepEqual(bytesOf(app, file), HIGHLIGHTED);
	assert.equal(fm(app, note).status, "reviewing");
	assert.equal(fm(app, note).highlights, 2);
	assert.match(content(app, note), /A sentence worth keeping\./);
	assert.ok(settings.tabletSent["smith2020.pdf"].returnedAt);
	assert.ok(ui.notices.some((n) => /2 annotations written to smith2020/.test(n)), ui.notices.join("\n"));

	assert.equal(await rt.checkAll(), 0, "imported once");
});

test("sending refuses to overwrite reading that hasn't come back", async () => {
	const { rt, tablet, note } = setup();
	await rt.send(note);
	tabletWrite(path.join(tablet, "smith2020.pdf"), HIGHLIGHTED);
	await assert.rejects(rt.send(note), /has changes that aren't in the vault yet/);
	// A file Stacks never sent is never overwritten either.
	const other = setup();
	fs.writeFileSync(path.join(other.tablet, "smith2020.pdf"), HIGHLIGHTED);
	await assert.rejects(other.rt.send(other.note), /has changes/);
});

test("a conflict keeps both copies, whichever the person chooses", async () => {
	for (const choice of ["vault", "tablet", "later"] as const) {
		const { app, rt, tablet, note, file, ui } = setup();
		ui.choice = choice;
		await rt.send(note);
		await app.vault.modifyBinary(file, toArrayBuffer(ONE_HIGHLIGHT)); // highlighted in PDF++ meanwhile
		tabletWrite(path.join(tablet, "smith2020.pdf"), HIGHLIGHTED);
		const n = await rt.checkAll();
		await flush();
		assert.equal(ui.conflicts.length, 1, choice);
		assert.equal(ui.conflicts[0].vault.annotations, 1);
		assert.equal(ui.conflicts[0].tablet.annotations, 2);
		const copies = app.vault.getFiles().filter((f) => f.name.includes("copy"));
		if (choice === "later") {
			assert.equal(n, 0);
			assert.equal(copies.length, 0);
			assert.deepEqual(bytesOf(app, file), ONE_HIGHLIGHT);
			await rt.checkAll();
			assert.equal(ui.conflicts.length, 2, "asked again next time");
			continue;
		}
		assert.equal(copies.length, 1, choice);
		const attachments = fm(app, note).attachments as string[];
		assert.ok(attachments.some((a) => a.includes(copies[0].name)), "the kept copy is linked from the note");
		if (choice === "vault") {
			assert.match(copies[0].name, /\(tablet copy \d{4}-\d{2}-\d{2}\)\.pdf$/);
			assert.deepEqual(bytesOf(app, file), ONE_HIGHLIGHT);
			assert.deepEqual(bytesOf(app, copies[0]), HIGHLIGHTED);
			assert.equal(await rt.checkAll(), 0);
			assert.equal(ui.conflicts.length, 1, "not asked again");
		} else {
			assert.match(copies[0].name, /\(vault copy \d{4}-\d{2}-\d{2}\)\.pdf$/);
			assert.deepEqual(bytesOf(app, file), HIGHLIGHTED);
			assert.deepEqual(bytesOf(app, copies[0]), ONE_HIGHLIGHT);
			assert.equal(fm(app, note).highlights, 2);
		}
	}
});

test("a renamed attachment is still found: by rename event, by the note's link, or by content", async () => {
	// Renamed while Obsidian runs.
	{
		const { app, rt, tablet, note, file, settings } = setup();
		await rt.send(note);
		await app.fileManager.renameFile(file, "References/attachments/renamed.pdf");
		await rt.onVaultRename(file, PDF);
		assert.equal(settings.tabletSent["smith2020.pdf"].attachment, "References/attachments/renamed.pdf");
		await app.fileManager.processFrontMatter(note, (f: any) => (f.pdf = "[[renamed.pdf]]"));
		tabletWrite(path.join(tablet, "smith2020.pdf"), HIGHLIGHTED);
		assert.equal(await rt.checkAll(), 1);
		assert.deepEqual(bytesOf(app, file), HIGHLIGHTED);
	}
	// Renamed while Obsidian was closed, and the note moved too: matched by content hash.
	{
		const { app, rt, tablet, note, file, settings } = setup();
		await rt.send(note);
		settings.tabletSent["smith2020.pdf"].attachment = "References/attachments/gone.pdf";
		settings.tabletSent["smith2020.pdf"].note = "References/gone.md";
		tabletWrite(path.join(tablet, "smith2020.pdf"), HIGHLIGHTED);
		assert.equal(await rt.checkAll(), 1);
		await flush();
		assert.deepEqual(bytesOf(app, file), HIGHLIGHTED);
		assert.equal(settings.tabletSent["smith2020.pdf"].attachment, PDF);
		assert.equal(fm(app, note).highlights, 2);
	}
});

test("the pre-extraction command processes a returned PDF before it is filed", async () => {
	// Appends a PDF comment: still a valid PDF, and recognizable.
	const script = `const f=require('fs');f.writeFileSync(process.argv[2],Buffer.concat([f.readFileSync(process.argv[1]),Buffer.from('%expanded\\n')]))`;
	const { app, rt, tablet, note, file, settings } = setup();
	settings.preExtractionCommand = `node -e "${script}" {in} {out}`;
	await rt.send(note);
	tabletWrite(path.join(tablet, "smith2020.pdf"), HIGHLIGHTED);
	assert.equal(await rt.checkAll(), 1);
	await flush();
	assert.match(new TextDecoder().decode(bytesOf(app, file)), /%expanded\n$/);
	assert.equal(fm(app, note).highlights, 2);
	assert.equal(await rt.checkAll(), 0, "the processed copy differing from the tablet copy is not a new return");
});

test("a failing pre-extraction command is reported and the PDF is used as returned", async () => {
	const { app, rt, tablet, note, file, settings, ui } = setup();
	settings.preExtractionCommand = `node -e "console.error('boom'); process.exit(3)" {in} {out}`;
	await rt.send(note);
	tabletWrite(path.join(tablet, "smith2020.pdf"), HIGHLIGHTED);
	assert.equal(await rt.checkAll(), 1);
	assert.deepEqual(bytesOf(app, file), HIGHLIGHTED);
	assert.ok(ui.notices.some((n) => /exited with 3: boom/.test(n)), ui.notices.join("\n"));
});

test("PDFs Stacks didn't send are brought back only when that option is on", async () => {
	for (const adopt of [false, true]) {
		const { app, rt, tablet, note, file } = setup({ tabletAdoptUnknown: adopt });
		tabletWrite(path.join(tablet, "smith2020.pdf"), HIGHLIGHTED);
		fs.writeFileSync(path.join(tablet, "unrelated.pdf"), CLEAN);
		assert.equal(await rt.checkAll(), adopt ? 1 : 0);
		await flush();
		assert.deepEqual(bytesOf(app, file), adopt ? HIGHLIGHTED : CLEAN);
		if (adopt) assert.equal(fm(app, note).highlights, 2);
	}
});

test("a missing tablet folder is a clear error", async () => {
	const { rt, note, settings } = setup();
	settings.tabletFolder = path.join(os.tmpdir(), "stacks-no-such-folder-" + Date.now());
	await assert.rejects(rt.send(note), /doesn't exist or isn't reachable/);
});

// ---------------------------------------------------------------- the plugin

class DesktopPlugin extends LibraryPlugin {
	protected createHost() {
		return nodeHost(this.app, modules);
	}
}

async function setupPlugin(overrides: Partial<LibrarySettings> = {}) {
	const app = new App();
	const tablet = tempFolder();
	const { note, file } = vaultWithReference(app, "queued");
	Notice.messages = [];
	const plugin = new DesktopPlugin(app as any, { id: "library" } as any);
	(plugin as any).data = { tabletFolder: tablet, ...overrides };
	await plugin.onload();
	plugin.roundTrip!.settleMs = 5;
	return { app, plugin, tablet, note, file };
}

test("changing the status to the send status copies the PDF to the tablet folder", async () => {
	const { app, plugin, tablet, note } = await setupPlugin();
	await app.fileManager.processFrontMatter(note, (f: any) => (f.status = "reading"));
	await until(() => fs.existsSync(path.join(tablet, "smith2020.pdf")));
	assert.ok(plugin.settings.tabletSent["smith2020.pdf"]);
	assert.ok(Notice.messages.some((m) => /sent smith2020\.pdf/.test(m)));
	plugin.unload();
});

test("commands: extract for the current note or its PDF; round-trip commands need a tablet folder", async () => {
	const { app, plugin, note, file } = await setupPlugin({ tabletFolder: "" });
	const cmd = (id: string) => plugin.commands.find((c: any) => c.id === id);
	app.workspace.active = file;
	assert.equal(cmd("extract-annotations").checkCallback(true), true, "available from the PDF");
	app.workspace.active = note;
	assert.equal(cmd("send-to-tablet").checkCallback(true), false);
	assert.equal(cmd("check-tablet-folder").checkCallback(true), false);
	app.vault.contents.set(file, toArrayBuffer(HIGHLIGHTED));
	cmd("extract-annotations").checkCallback(false);
	await until(() => fm(app, note).highlights === 2);
	plugin.unload();
});

test("extract on save re-extracts when the PDF changes in the vault", async () => {
	const { app, plugin, note, file } = await setupPlugin({ tabletFolder: "", extractOnPdfSave: true });
	await app.vault.modifyBinary(file, toArrayBuffer(HIGHLIGHTED));
	await until(() => fm(app, note).highlights === 2, 5000);
	plugin.unload();
});

// ---------------------------------------------------------------- PR #37 review regressions

const VAULT_EDIT = buildPdf([{ text: TEXT, annots: [{ subtype: "StrikeOut", rect: [72, 695, 300, 712], quads: lineQuad(72, 300, 700), color: [0.6, 0.5, 0.9] }] }]);

test("a tablet copy touched without changes keeps the vault edit as an edit, so a later return is a conflict", async () => {
	const { app, rt, tablet, note, file, ui, settings } = setup();
	await rt.send(note);
	const sent = { ...settings.tabletSent["smith2020.pdf"] };
	await app.vault.modifyBinary(file, toArrayBuffer(VAULT_EDIT)); // edited in the vault, never sent
	tabletWrite(path.join(tablet, "smith2020.pdf"), CLEAN); // sync client re-saves the same content
	assert.equal(await rt.checkAll(), 0);
	assert.equal(settings.tabletSent["smith2020.pdf"].vaultHash, sent.vaultHash, "baseline unchanged");
	tabletWrite(path.join(tablet, "smith2020.pdf"), HIGHLIGHTED);
	assert.equal(await rt.checkAll(), 0, "later: nothing replaced");
	assert.equal(ui.conflicts.length, 1, "seen as a conflict, not a plain return");
	assert.deepEqual(bytesOf(app, file), VAULT_EDIT);
	void note;
});

test("a tablet file that never stops changing is left for later", async () => {
	let tick = 0;
	const { app, rt, tablet, note, file, settings } = setup({}, (host) => ({
		...host,
		// Every look at the file sees a new modification time: a sync that never finishes.
		stat: async (p) => {
			const st = await host.stat(p);
			return st && p.endsWith("smith2020.pdf") ? { ...st, mtimeMs: st.mtimeMs + ++tick } : st;
		},
	}));
	await rt.send(note);
	const before = { ...settings.tabletSent["smith2020.pdf"] };
	tabletWrite(path.join(tablet, "smith2020.pdf"), HIGHLIGHTED);
	assert.equal(await rt.checkAll(), 0);
	assert.deepEqual(bytesOf(app, file), CLEAN);
	assert.equal(settings.tabletSent["smith2020.pdf"].externalHash, before.externalHash, "still waiting for the return");
});

test("a returned copy PDF.js can't open never replaces the vault copy", async () => {
	const { app, rt, tablet, note, file, ui } = setup();
	await rt.send(note);
	tabletWrite(path.join(tablet, "smith2020.pdf"), new TextEncoder().encode("%PDF-1.7\npartial syncing data"));
	assert.equal(await rt.checkAll(), 0);
	assert.deepEqual(bytesOf(app, file), CLEAN);
	assert.ok(ui.notices.some((n) => /isn't a readable PDF yet/.test(n)), ui.notices.join("\n"));
	// Once the full file arrives it comes back normally.
	tabletWrite(path.join(tablet, "smith2020.pdf"), HIGHLIGHTED);
	assert.equal(await rt.checkAll(), 1);
	assert.deepEqual(bytesOf(app, file), HIGHLIGHTED);
});

test("a vault change while the conflict dialog is open is never lost", async () => {
	const NEWEST = ONE_HIGHLIGHT;
	for (const choice of ["tablet", "vault"] as const) {
		const { app, rt, tablet, note, file, ui } = setup();
		ui.choice = choice;
		await rt.send(note);
		await app.vault.modifyBinary(file, toArrayBuffer(VAULT_EDIT));
		tabletWrite(path.join(tablet, "smith2020.pdf"), HIGHLIGHTED);
		ui.whileOpen = async () => {
			await app.vault.modifyBinary(file, toArrayBuffer(NEWEST)); // saved in PDF++ meanwhile
		};
		assert.equal(await rt.checkAll(), 0, choice);
		assert.deepEqual(bytesOf(app, file), NEWEST, choice);
		assert.equal(app.vault.getFiles().filter((f) => f.name.includes("copy")).length, 0, "nothing saved from a stale snapshot");
		assert.ok(ui.notices.some((n) => /changed in the vault while you were deciding/.test(n)));
		// Asked again with the current copies.
		ui.whileOpen = async () => undefined;
		ui.choice = "later";
		await rt.checkAll();
		assert.equal(ui.conflicts.length, 2);
		assert.equal(ui.conflicts[1].vault.annotations, 1);
	}
});

test("a vault change while the pre-extraction command runs is never overwritten", async () => {
	const NEWEST = ONE_HIGHLIGHT;
	let appRef: App | null = null;
	let fileRef: TFile | null = null;
	const { app, rt, tablet, note, file, settings, ui } = setup({}, (host, a) => {
		appRef = a;
		return {
			...host,
			run: async (cmd, cwd, timeout) => {
				await appRef!.vault.modifyBinary(fileRef!, toArrayBuffer(NEWEST));
				return host.run(cmd, cwd, timeout);
			},
		};
	});
	fileRef = file;
	settings.preExtractionCommand = `node -e "require('fs').copyFileSync(process.argv[1], process.argv[2])" {in} {out}`;
	await rt.send(note);
	tabletWrite(path.join(tablet, "smith2020.pdf"), HIGHLIGHTED);
	assert.equal(await rt.checkAll(), 0);
	assert.deepEqual(bytesOf(app, file), NEWEST);
	assert.ok(ui.notices.some((n) => /changed in the vault while it was being brought back/.test(n)));
});

test("after a vault rename, the record stays under the tablet name through several returns", async () => {
	const { app, rt, tablet, note, file, settings, ui } = setup();
	await rt.send(note);
	await app.fileManager.renameFile(file, "References/attachments/renamed.pdf");
	await rt.onVaultRename(file, PDF);
	await app.fileManager.processFrontMatter(note, (f: any) => (f.pdf = "[[renamed.pdf]]"));
	await flush();
	tabletWrite(path.join(tablet, "smith2020.pdf"), HIGHLIGHTED);
	assert.equal(await rt.checkAll(), 1);
	assert.deepEqual(Object.keys(settings.tabletSent), ["smith2020.pdf"]);
	tabletWrite(path.join(tablet, "smith2020.pdf"), ONE_HIGHLIGHT);
	assert.equal(await rt.checkAll(), 1, "second return is a plain return");
	assert.equal(ui.conflicts.length, 0);
	assert.deepEqual(bytesOf(app, file), ONE_HIGHLIGHT);
	// Sending again uses the same tablet name.
	await app.vault.modifyBinary(file, toArrayBuffer(CLEAN));
	tabletWrite(path.join(tablet, "smith2020.pdf"), ONE_HIGHLIGHT); // unchanged content, so it can be replaced
	assert.match(await rt.send(note), /smith2020\.pdf/);
	assert.ok(!fs.existsSync(path.join(tablet, "renamed.pdf")));
});

test("extraction writes nothing once the plugin is unloaded", async () => {
	const { app, library, settings, note, file } = setup();
	let alive = true;
	const extractor = new Extractor(app as any, library, () => settings, () => alive);
	app.vault.contents.set(file, toArrayBuffer(HIGHLIGHTED));
	const before = content(app, note);
	const run = extractor.extract(note);
	alive = false; // disabled while PDF.js reads the file
	await assert.rejects(run, (e: unknown) => e instanceof Cancelled);
	await flush();
	assert.equal(content(app, note), before);
	assert.equal(fm(app, note).highlights, undefined);
});
