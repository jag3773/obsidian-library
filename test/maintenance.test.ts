// Health check, relinking and merging against the in-memory Obsidian stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App, TFile } from "obsidian";
import { Library } from "../src/library";
import { Maintenance } from "../src/maintenance";
import { withDefaults } from "../src/settings";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function flush(rounds = 10) {
	for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

function setup() {
	const app = new App();
	const settings = withDefaults({});
	const library = new Library(app as any, () => settings);
	const maintenance = new Maintenance(app as any, library, () => settings);
	return { app, settings, library, maintenance };
}

const md = (fm: Record<string, unknown>, body = "") => `---\n${JSON.stringify(fm)}\n---\n${body}`;
const fm = (app: App, f: TFile) => app.metadataCache.getFileCache(f)?.frontmatter ?? {};
const commands = { check: "C", relink: "R", review: "V", mergeCurrent: "M" };

test("the health check reads only, then writes just its report beside the references folder", async () => {
	const { app, maintenance } = setup();
	const good = app.vault.addFile("References/smith2020.md", md({ citekey: "smith2020", type: "book", title: "T", authors: ["A B"], year: 2020, publisher: "P", pdf: "[[old.pdf]]" }));
	app.vault.addFile("References/broken.md", "---\ntitle: [unclosed\n---\nBody");
	app.vault.addFile("References/attachments/smith2020.pdf", new ArrayBuffer(4));
	app.vault.addFile("References/attachments/stray.pdf", new ArrayBuffer(4));
	const before = new Map([...app.vault.contents].map(([f, c]) => [f.path, c]));
	const r = await maintenance.check();
	for (const [f, c] of app.vault.contents) assert.equal(c, before.get(f.path), `${f.path} unchanged`);
	assert.deepEqual(r.brokenFrontmatter.map((b) => b.path), ["References/broken.md"]);
	assert.deepEqual(r.unresolvedPdf, [{ path: good.path, value: "[[old.pdf]]", candidate: "References/attachments/smith2020.pdf" }]);
	assert.deepEqual(r.repairs, [{ note: good.path, pdf: "References/attachments/smith2020.pdf", previous: "[[old.pdf]]" }]);
	assert.deepEqual(r.orphanPdfs.map((o) => o.path), ["References/attachments/smith2020.pdf", "References/attachments/stray.pdf"]);

	const report = await maintenance.writeReport(r, commands);
	assert.equal(report.path, "Stacks health check.md");
	assert.match(await app.vault.read(report), /\[\[References\/broken\|broken\]\]/);
	// A second run rewrites the same note.
	assert.equal((await maintenance.writeReport(r, commands)).path, report.path);
});

test("relinking points pdf at the PDF named after the citekey and fixes the attachments entry", async () => {
	const { app, maintenance } = setup();
	const note = app.vault.addFile("References/smith2020.md", md({ citekey: "smith2020", pdf: "[[old.pdf]]", attachments: ["[[old.pdf]]", "[[notes.txt]]"] }));
	app.vault.addFile("References/attachments/smith2020.pdf", new ArrayBuffer(4));
	const { repairs } = await maintenance.check();
	assert.equal(await maintenance.applyRepair(repairs[0]), true);
	await flush();
	assert.equal(fm(app, note).pdf, "[[smith2020.pdf]]");
	assert.deepEqual(fm(app, note).attachments, ["[[smith2020.pdf]]", "[[notes.txt]]"]);
	// Already repaired (the pdf changed since the check): skipped.
	assert.equal(await maintenance.applyRepair(repairs[0]), false);
});

test("relinking a note without a pdf to its unlinked PDF", async () => {
	const { app, maintenance } = setup();
	const note = app.vault.addFile("References/smith2020.md", md({ citekey: "smith2020" }));
	app.vault.addFile("References/attachments/smith2020.pdf", new ArrayBuffer(4));
	const { repairs } = await maintenance.check();
	assert.deepEqual(repairs, [{ note: note.path, pdf: "References/attachments/smith2020.pdf" }]);
	await maintenance.applyRepair(repairs[0]);
	await flush();
	assert.equal(fm(app, note).pdf, "[[smith2020.pdf]]");
	assert.deepEqual(fm(app, note).attachments, ["[[smith2020.pdf]]"]);
});

test("merge: preview counts links, then merge fills, unions, copies prose, repoints links and trashes", async () => {
	const { app, maintenance } = setup();
	const keep = app.vault.addFile(
		"References/smith2020.md",
		md({ citekey: "smith2020", doi: "10.1000/x", title: "T", collections: ["[[A]]"] }, "# T\n\nShared.\n")
	);
	const drop = app.vault.addFile(
		"References/smith2020a.md",
		md({ citekey: "smith2020a", doi: "10.1000/X", title: "T", publisher: "P", collections: ["[[B]]"] }, "# T\n\nShared.\n\nOnly in the duplicate, see [[smith2020a#^x]].\n")
	);
	const draft = app.vault.addFile("Drafts/essay.md", md({ related: "[[smith2020a]]" }, "As [[smith2020a|Smith]] says, and ![[smith2020a]]. `[[smith2020a]]` in code stays.\n"));
	const other = app.vault.addFile("Drafts/other.md", "No links here.");

	const groups = maintenance.duplicateGroups();
	assert.deepEqual(groups.map((g) => g.paths), [[keep.path, drop.path]]);

	const plan = await maintenance.planMerge(keep, drop);
	assert.deepEqual(plan.links.map((l) => [l.file.path, l.count]), [["Drafts/essay.md", 3]]);
	assert.deepEqual(plan.changes.map((c) => [c.property, c.kind]), [["publisher", "fill"], ["collections", "union"]]);
	assert.equal(plan.paragraphsAdded, 1);
	// The preview wrote nothing.
	assert.ok(app.vault.getAbstractFileByPath(drop.path));

	const r = await maintenance.merge(plan);
	assert.deepEqual(r, { linksChanged: 4, filesChanged: 2 });
	await flush();
	assert.equal(app.vault.getAbstractFileByPath(drop.path), null);
	assert.deepEqual((app.fileManager as any).trashed, [drop.path]);
	assert.equal(fm(app, keep).citekey, "smith2020");
	assert.equal(fm(app, keep).publisher, "P");
	assert.deepEqual(fm(app, keep).collections, ["[[A]]", "[[B]]"]);
	const keepText = await app.vault.read(keep);
	// The copied paragraph's own link to the duplicate now points to the kept note.
	assert.match(keepText, /## Merged from smith2020a\n\nOnly in the duplicate, see \[\[smith2020#\^x\]\]\.\n$/);
	const draftText = await app.vault.read(draft);
	assert.equal(draftText, md({ related: "[[smith2020]]" }, "As [[smith2020|Smith]] says, and ![[smith2020]]. `[[smith2020a]]` in code stays.\n"));
	assert.equal(await app.vault.read(other), "No links here.");
});

test("merge refuses when a note was deleted after the preview", async () => {
	const { app, maintenance } = setup();
	const keep = app.vault.addFile("References/a.md", md({ citekey: "a", doi: "10.1000/x" }));
	const drop = app.vault.addFile("References/b.md", md({ citekey: "b", doi: "10.1000/x" }));
	const plan = await maintenance.planMerge(keep, drop);
	await app.fileManager.trashFile(drop);
	await assert.rejects(maintenance.merge(plan), /moved or deleted/);
});
