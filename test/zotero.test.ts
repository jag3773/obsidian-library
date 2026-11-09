// #18: importing a Better BibTeX JSON export.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App, TFile, parseYaml } from "obsidian";
import { Library } from "../src/library";
import { withDefaults } from "../src/settings";
import { BbtExport, DEFAULT_IMPORT_CHOICES, ImportChoices, hasAnnotations, itemToReference, parseTagRules, planImport, repairFrontmatter, zoteroName } from "../src/zotero";
import { ZoteroImporter, importReportMarkdown } from "../src/zoteroImport";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function flush(rounds = 30) {
	for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

const ZI_BODY = (title: string, key: string, annotations = "") =>
	`\n# ${title}\n## Metadata\n> [!info]\n> - URL:: \n> - [Item in Zotero](zotero://select/library/items/${key})\n\n## Annotations\n${annotations}\n%% Import Date: 2023-02-04 %%\n`;

const EXPORT: BbtExport = {
	collections: {
		A: { name: "Queued", items: [1, 3] },
		B: { name: "Read", items: [2] },
		C: { name: "References", items: [1, 2, 3, 4, 5, 6] },
		D: { name: "Climate", items: [1] },
	},
	items: [
		{
			key: "AAAAAAA1",
			itemID: 1,
			itemType: "book",
			citationKey: "doeExampleBook2006",
			title: "Example Book",
			creators: [
				{ creatorType: "author", firstName: "Jane", lastName: "Doe" },
				{ creatorType: "translator", firstName: "Gijs", lastName: "de Lange" },
			],
			date: "2006-03",
			dateAdded: "2022-12-14T10:00:00Z",
			publisher: "Example Press",
			place: "Chicago",
			ISBN: "978-0-14-312837-3 0143128379",
			tags: [{ tag: "Own" }, { tag: "Reviewed in 2024" }, { tag: "_reviewing" }, { tag: "Leadership", type: 1 }],
			attachments: [
				{ title: "pdf", path: "/Users/x/Vault/archive/zotero/doeExampleBook2006.pdf" },
				{ title: "snap", path: "/Users/x/Zotero/storage/ABCD1234/page.html" },
				{ title: "elsewhere", path: "/Users/x/Downloads/scan.pdf" },
			],
			callNumber: "QA76",
			shortTitle: "Example",
		},
		{
			key: "AAAAAAA2",
			itemID: 2,
			itemType: "journalArticle",
			citationKey: "smithNewKey2020",
			title: "Changed Key Article",
			creators: [{ creatorType: "author", firstName: "Ann", lastName: "Smith" }],
			date: "2020-05-01",
			publicationTitle: "Journal of Things",
			volume: "12",
			issue: "3",
			pages: "1-10",
			extra: "DOI: 10.1000/abc",
			tags: [],
		},
		{
			key: "AAAAAAA3",
			itemID: 3,
			itemType: "videoRecording",
			citationKey: "acmTalk2021",
			title: "A Talk Found By Title",
			creators: [{ creatorType: "director", name: "ACM SIGCHI" }],
			date: "2021",
			tags: [],
		},
		{
			key: "AAAAAAA4",
			itemID: 4,
			itemType: "webpage",
			citationKey: "newItemNoNote2024",
			title: "An Item With No Note",
			url: "https://example.com/new",
			accessDate: "2024-01-02T03:04:05Z",
			abstractNote: "Abstract here.",
			notes: [{ note: "<p>A <b>Zotero</b> note.</p>" }],
			tags: [],
		},
		{ key: "AAAAAAA5", itemID: 5, itemType: "book", citationKey: "dupInZotero2019a", title: "Example Book", tags: [] },
		{ key: "AAAAAAA6", itemID: 6, itemType: "blogPost", citationKey: "brokenYaml2023", title: "Broken Yaml Post", blogTitle: "A Blog", tags: [] },
		{ key: "AAAAAAA7", itemID: 7, itemType: "attachment", title: "loose file" } as any,
	],
};

/** A vault shaped like a Zotero Integration library, mid-migration. */
function vault() {
	const app = new App();
	const files: Record<string, string> = {
		// Filename = citekey, with highlights; the reading-workflow collection says Queued.
		"References/doeExampleBook2006.md": `---\ncssclass: literature-note\naliases:\n  - Example Book\n---${ZI_BODY("Example Book", "AAAAAAA1", "> Highlighted 2024-03-01\n> A passage.")}`,
		// Named by an old citekey; only the zotero:// link connects it to the item.
		"References/smithOldKey2020.md": `---\naliases: [Changed Key Article]\n---${ZI_BODY("Changed Key Article", "AAAAAAA2")}`,
		// Matched by its title alone.
		"References/someTalk.md": `---\ntitle: A Talk Found By Title\n---\n# A Talk Found By Title\n`,
		// A second note for item 1: an earlier re-import.
		"References/doeExampleBook2006a.md": `---\n{}\n---${ZI_BODY("Example Book (old)", "AAAAAAA1")}`,
		// From a group library.
		"References/groupItem.md": `---\n{}\n---\n# Group\n[Item in Zotero](zotero://select/groups/123/items/GGGGGGG1)\n`,
		// Linked to an item that's no longer in Zotero.
		"References/deletedItem.md": `---\n{}\n---${ZI_BODY("Deleted", "ZZZZZZZ9")}`,
		// Zotero Integration's unescaped quotes.
		"References/brokenYaml2023.md": `---\ncssclass: literature-note\naliases:\n  - "Broken "Yaml" Post"\ncitekey: brokenYaml2023\n---${ZI_BODY("Broken Yaml Post", "AAAAAAA6")}`,
		"References/notFromZotero.md": `---\ncitekey: mine2025\ntitle: My Own\n---\n# My Own\n`,
		"archive/zotero/doeExampleBook2006.pdf": "%PDF",
		"zotero-export.json": JSON.stringify(EXPORT),
	};
	for (const [p, c] of Object.entries(files)) app.vault.addFile(p, c);
	const settings = withDefaults({});
	const library = new Library(app as any, () => settings);
	const importer = new ZoteroImporter(app as any, library, () => settings, ".obsidian/plugins/library/backups");
	const choices: ImportChoices = {
		...DEFAULT_IMPORT_CHOICES,
		exportPath: "zotero-export.json",
		collections: { Queued: { kind: "status", status: "queued" }, Read: { kind: "status", status: "processed" }, References: { kind: "drop" } },
		tagRules: "Own = owned: true\n_reviewing = status: reviewing\nReviewed-in-* = status: processed",
		fallbackStatus: "shelved",
		annotatedStatus: "processed",
		renameToCurrentKeys: true,
	};
	return { app, settings, library, importer, choices, files };
}

const body = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n?/, "");
const fm = (app: App, path: string) => app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(path) as TFile)?.frontmatter ?? {};

test("Zotero items map to the plugin's fields and roles", () => {
	const book = itemToReference(EXPORT.items[0]);
	assert.equal(book.type, "book");
	assert.deepEqual(book.authors, ["Jane Doe"]);
	assert.deepEqual(book.translators, ["Gijs de Lange"]);
	assert.deepEqual(book.names?.translators, [{ given: "Gijs", particle: "de", family: "Lange" }]);
	assert.equal(book.isbn, "9780143128373");
	assert.equal(book.date, "2006-03");
	assert.equal(book.place, "Chicago");
	const article = itemToReference(EXPORT.items[1]);
	assert.equal(article.doi, "10.1000/abc", "a DOI kept in Extra");
	assert.equal(article.journal, "Journal of Things");
	assert.equal(article.pages, "1-10");
	assert.deepEqual(itemToReference(EXPORT.items[2]).names?.authors, [{ literal: "ACM SIGCHI" }], "a single-field name stays whole");
	const page = itemToReference(EXPORT.items[3]);
	assert.equal(page.accessed, "2024-01-02");
	assert.equal(itemToReference(EXPORT.items[5]).type, "article", "blog posts are articles");
	assert.equal(itemToReference(EXPORT.items[5]).journal, "A Blog");
	assert.deepEqual(zoteroName({ firstName: "", lastName: "aabatayo" }), { literal: "aabatayo" });
	assert.equal(itemToReference({ key: "K", itemType: "book" }).title, "", "no title proposes none");
});

test("the dry run: matching order, duplicates, group and deleted items, repairs, all without writing", async () => {
	const { app, importer, choices, files } = vault();
	const { plan } = await importer.plan(choices);
	const r = plan.report;
	assert.equal(r.items, 6, "attachments aren't items");
	assert.deepEqual(r.matched, { filename: 2, "citekey property": 0, "Zotero link": 1, identifier: 0, title: 1 });
	const by = Object.fromEntries(plan.updates.map((u) => [u.note.basename, u]));
	assert.equal(by.doeExampleBook2006.matchedBy, "filename");
	assert.equal(by.brokenYaml2023.matchedBy, "filename");
	assert.equal(by.smithOldKey2020.matchedBy, "Zotero link");
	assert.equal(by.someTalk.matchedBy, "title");
	assert.equal(by.smithOldKey2020.renameTo, "References/smithNewKey2020.md");
	assert.deepEqual(r.duplicateNotes, [{ note: "References/doeExampleBook2006a.md", keptNote: "References/doeExampleBook2006.md", citekey: "doeExampleBook2006" }]);
	assert.deepEqual(r.groupNotes, ["References/groupItem.md"]);
	assert.deepEqual(r.missingFromExport, ["References/deletedItem.md"]);
	assert.deepEqual(r.repairedNotes, ["References/brokenYaml2023.md"]);
	assert.deepEqual(r.zoteroDuplicates.map((d) => d.citekey), ["dupInZotero2019a"]);
	assert.deepEqual(plan.creates.map((c) => c.path), ["References/newItemNoNote2024.md"]);
	assert.equal(r.snapshotsLeftInZotero, 1);
	assert.deepEqual(r.attachmentsNotInVault, [{ citekey: "doeExampleBook2006", path: "/Users/x/Downloads/scan.pdf" }]);
	assert.deepEqual(r.unmappedFields, { callNumber: 1, shortTitle: 1, extra: 1 });
	for (const [p, c] of Object.entries(files)) {
		const f = app.vault.getAbstractFileByPath(p) as TFile;
		assert.equal(await app.vault.read(f), c, `${p} untouched by the dry run`);
	}
});

test("status: a tag's rule first, then highlights, then collections, then the fallback", async () => {
	const { importer, choices } = vault();
	const { plan } = await importer.plan(choices);
	const status = (name: string) => [...plan.updates.map((u) => [u.note.basename, u.extras.status]), ...plan.creates.map((c) => [c.extras.citekey, c.extras.status])].find(([n]) => n === name)?.[1];
	assert.equal(status("doeExampleBook2006"), "reviewing", "_reviewing is listed before Reviewed-in-*");
	assert.equal(status("smithOldKey2020"), "processed", "the Read collection");
	assert.equal(status("someTalk"), "queued", "the Queued collection");
	assert.equal(status("newItemNoNote2024"), "shelved", "the fallback; References is dropped");

	const noTags = await importer.plan({ ...choices, tagRules: "" });
	const doe = noTags.plan.updates.find((u) => u.note.basename === "doeExampleBook2006")!;
	assert.equal(doe.extras.status, "processed", "highlights beat the Queued collection");
	assert.match(noTags.plan.report.statusConflicts[0].detail, /queued by collection, but already annotated/);
	assert.deepEqual(doe.extras.collections, ["Climate"], "status and dropped collections aren't kept as collections");
	assert.deepEqual(doe.extras.tags, ["Own", "Reviewed-in-2024", "_reviewing", "Leadership"], "without rules, tags stay tags, in tag form");
	const manualOnly = await importer.plan({ ...choices, tagRules: "", automaticTags: false });
	assert.deepEqual(manualOnly.plan.updates.find((u) => u.note.basename === "doeExampleBook2006")!.extras.tags, ["Own", "Reviewed-in-2024", "_reviewing"]);
});

test("import: properties added, bodies byte-for-byte unchanged, renames and creates, report and backup", async () => {
	const { app, importer, choices, files } = vault();
	const { plan } = await importer.plan(choices);
	const backup = await importer.apply(plan, choices);
	await flush();

	for (const [was, now] of [
		["References/doeExampleBook2006.md", "References/doeExampleBook2006.md"],
		["References/someTalk.md", "References/acmTalk2021.md"],
		["References/brokenYaml2023.md", "References/brokenYaml2023.md"],
	]) {
		const text = await app.vault.read(app.vault.getAbstractFileByPath(now) as TFile);
		assert.equal(body(text), body(files[was]), `${was}: body unchanged`);
	}
	const doe = fm(app, "References/doeExampleBook2006.md");
	assert.equal(doe.cssclass, "literature-note", "existing properties kept");
	assert.equal(doe.citekey, "doeExampleBook2006");
	assert.deepEqual(doe.authors, ["[[Jane Doe]]"]);
	assert.deepEqual(doe.translators, ["[[Gijs de Lange]]"]);
	assert.equal(doe.owned, true);
	assert.equal(doe.status, "reviewing");
	assert.deepEqual(doe.collections, ["[[Climate]]"]);
	assert.equal(doe.pdf, "[[doeExampleBook2006.pdf]]");
	assert.equal(doe.added, "2022-12-14");
	assert.equal(doe.published, "2006-03");
	assert.equal(doe.zotero, "zotero://select/library/items/AAAAAAA1");

	assert.equal(app.vault.getAbstractFileByPath("References/smithOldKey2020.md"), null);
	const smith = fm(app, "References/smithNewKey2020.md");
	assert.equal(smith.citekey, "smithNewKey2020", "renamed notes take the current key");
	assert.equal(smith.doi, "10.1000/abc");
	assert.deepEqual(fm(app, "References/acmTalk2021.md").authors, ["[[ACM SIGCHI|{ACM SIGCHI}]]"], "matched by title, then named by its citekey");

	const repaired = fm(app, "References/brokenYaml2023.md");
	assert.deepEqual(repaired.aliases, ["Broken Yaml Post"], "aliases rebuilt from the heading");
	assert.equal(repaired.cssclass, "literature-note");
	assert.equal(repaired.type, "article");

	const created = app.vault.getAbstractFileByPath("References/newItemNoNote2024.md") as TFile;
	const text = await app.vault.read(created);
	assert.match(text, /## Abstract\nAbstract here\./);
	assert.match(text, /## Zotero notes\n\nA Zotero note\./);
	assert.equal(fm(app, created.path).accessed, "2024-01-02");

	assert.equal(fm(app, "References/doeExampleBook2006a.md").authors, undefined, "a duplicate note is reported, not written");
	assert.equal(fm(app, "References/groupItem.md").authors, undefined);
	assert.equal(await app.vault.read(app.vault.getAbstractFileByPath("References/notFromZotero.md") as TFile), files["References/notFromZotero.md"]);

	const report = await app.vault.read(app.vault.getAbstractFileByPath(backup.reportPath) as TFile);
	assert.match(report, /\| Notes updated \| 4 \|/);
	assert.match(report, /## Duplicate notes to merge \(1\)/);
	assert.match(report, /## Notes from a group library \(1\)/);
	assert.match(report, /\/Users\/x\/Downloads\/scan\.pdf/);
	assert.match(report, /Export PDF/);
	assert.deepEqual(backup.created, ["References/newItemNoNote2024.md"]);
	assert.deepEqual(backup.renamed, [
		{ from: "References/smithOldKey2020.md", to: "References/smithNewKey2020.md" },
		{ from: "References/someTalk.md", to: "References/acmTalk2021.md" },
	]);
	assert.ok(await app.vault.adapter.exists(importer.lastBackup));
});

test("import is repeatable: a second run changes nothing", async () => {
	const { app, importer, choices } = vault();
	await importer.apply((await importer.plan(choices)).plan, choices);
	await flush();
	const snapshot = new Map<string, string>();
	for (const f of app.vault.getMarkdownFiles()) if (f.path.startsWith("References/")) snapshot.set(f.path, await app.vault.read(f));
	const again = await importer.plan(choices);
	assert.equal(again.plan.creates.length, 0);
	assert.equal(again.plan.updates.filter((u) => u.renameTo).length, 0);
	await importer.apply(again.plan, choices);
	await flush();
	for (const [p, text] of snapshot) assert.equal(await app.vault.read(app.vault.getAbstractFileByPath(p) as TFile), text, p);
});

test("existing values are kept unless Zotero's values win, and workflow values are never replaced", async () => {
	const { app, importer, choices } = vault();
	app.vault.addFile("References/acmTalk2021.md", `---\ntitle: My Better Title\nstatus: reading\n---\n# x\n`);
	await importer.apply((await importer.plan(choices)).plan, choices);
	await flush();
	assert.equal(fm(app, "References/acmTalk2021.md").title, "My Better Title");
	assert.equal(fm(app, "References/acmTalk2021.md").status, "reading");

	const second = vault();
	second.app.vault.addFile("References/acmTalk2021.md", `---\ntitle: My Better Title\nstatus: reading\n---\n# x\n`);
	const wins = { ...second.choices, zoteroWins: true };
	await second.importer.apply((await second.importer.plan(wins)).plan, wins);
	await flush();
	assert.equal(fm(second.app, "References/acmTalk2021.md").title, "A Talk Found By Title");
	assert.equal(fm(second.app, "References/acmTalk2021.md").status, "reading", "status is yours");
});

test("undo restores every note, renames back and trashes created notes", async () => {
	const { app, importer, choices, files } = vault();
	await importer.apply((await importer.plan(choices)).plan, choices);
	await flush();
	const r = await importer.undo(importer.lastBackup);
	await flush();
	assert.equal(r.trashed, 1);
	assert.deepEqual(r.skipped, []);
	for (const [p, c] of Object.entries(files)) {
		if (!p.startsWith("References/")) continue;
		const f = app.vault.getAbstractFileByPath(p) as TFile;
		assert.ok(f, `${p} is back`);
		assert.equal(await app.vault.read(f), c, p);
	}
	assert.equal(app.vault.getAbstractFileByPath("References/newItemNoNote2024.md"), null);
	assert.deepEqual((app.fileManager as any).trashed, ["References/newItemNoNote2024.md"]);
});

test("without renaming, drifted keys are reported and the filename stays the citekey", async () => {
	const { app, importer, choices } = vault();
	const keep = { ...choices, renameToCurrentKeys: false };
	const { plan } = await importer.plan(keep);
	assert.deepEqual(plan.report.keyChanges, [
		{ note: "References/smithOldKey2020.md", citekey: "smithNewKey2020", renamed: false },
		{ note: "References/someTalk.md", citekey: "acmTalk2021", renamed: false },
	]);
	await importer.apply(plan, keep);
	await flush();
	assert.equal(fm(app, "References/smithOldKey2020.md").citekey, "smithOldKey2020");
});

test("a citekey that already names another note is never a rename target", () => {
	const notes = [
		{ path: "R/old.md", basename: "old", frontmatter: {}, body: "[x](zotero://select/library/items/KKKKKKK1)" },
		{ path: "R/other.md", basename: "other", frontmatter: { title: "Unrelated" }, body: "" },
	];
	const exp: BbtExport = { items: [{ key: "KKKKKKK1", itemType: "book", citationKey: "Other", title: "T" }] };
	const plan = planImport(exp, notes, {
		properties: withDefaults({}).propertyNames,
		collections: {},
		tags: {},
		statuses: [],
		fallbackStatus: "",
		annotatedStatus: "",
		automaticTags: true,
		createMissing: true,
		renameToCurrentKeys: true,
		zoteroWins: false,
		referencesFolder: "R",
		findAttachment: () => undefined,
		parseYaml,
	});
	// "Other" matches other.md by filename first; old.md is then a duplicate, not renamed onto it.
	assert.equal(plan.updates[0].note.path, "R/other.md");
	assert.equal(plan.updates[0].renameTo, undefined);
	assert.deepEqual(plan.report.duplicateNotes.map((d) => d.note), ["R/old.md"]);
});

test("helpers: annotations, YAML repair, tag rules, report", () => {
	assert.equal(hasAnnotations("## Annotations\n> Highlighted 2024-01-01\n"), true);
	assert.equal(hasAnnotations("## Annotations\n![[x.png]]\n"), true);
	assert.equal(hasAnnotations("## Annotations\nComment: 11+6 pages\n%% Import Date %%\n"), false, "a copied Zotero note isn't a highlight");
	assert.equal(hasAnnotations("## Notes\n> quote\n"), false);
	assert.deepEqual(repairFrontmatter('a: 1\naliases:\n  - "x "y" z"\nb: two', "# Heading\n", parseYaml), { a: 1, b: "two", aliases: ["Heading"] });
	assert.deepEqual(parseTagRules("Own = owned: true\nrating-* = stars: 5\n# comment\nbad line"), {
		rules: { own: { property: "owned", value: true }, "rating-*": { property: "stars", value: 5 } },
		errors: ['"bad line" isn\'t "tag = property: value"'],
	});
	const empty = planImport({ items: [] }, [], { ...vault().importer.options(DEFAULT_IMPORT_CHOICES) });
	const md = importReportMarkdown(empty.report, empty, { ...DEFAULT_IMPORT_CHOICES, exportPath: "e.json" });
	assert.match(md, /Dry run: nothing written/);
});

test("two imports in the same minute keep separate backups, and undo walks back through both", async () => {
	const { app, importer, choices, files } = vault();
	await importer.apply((await importer.plan(choices)).plan, choices);
	await flush();
	const first = importer.lastBackup;
	await importer.apply((await importer.plan({ ...choices, zoteroWins: true })).plan, { ...choices, zoteroWins: true });
	await flush();
	const second = importer.lastBackup;
	assert.notEqual(first, second);
	await importer.undo(second);
	await importer.undo(first);
	await flush();
	for (const [p, c] of Object.entries(files)) {
		if (!p.startsWith("References/")) continue;
		assert.equal(await app.vault.read(app.vault.getAbstractFileByPath(p) as TFile), c, p);
	}
});

const opts = (over: Partial<Parameters<typeof planImport>[2]> = {}) => ({
	properties: withDefaults({}).propertyNames,
	collections: {},
	tags: {},
	statuses: [],
	fallbackStatus: "",
	annotatedStatus: "",
	automaticTags: true,
	createMissing: false,
	renameToCurrentKeys: true,
	zoteroWins: false,
	referencesFolder: "R",
	findAttachment: () => undefined,
	parseYaml,
	...over,
});

test("a title shared by two items matches neither", () => {
	const notes = [{ path: "R/n.md", basename: "n", frontmatter: { title: "Introduction" }, body: "" }];
	const exp: BbtExport = {
		items: [
			{ key: "KKKKKKK1", itemType: "bookSection", citationKey: "a2020", title: "Introduction" },
			{ key: "KKKKKKK2", itemType: "bookSection", citationKey: "b2021", title: "Introduction" },
		],
	};
	const plan = planImport(exp, notes, opts());
	assert.equal(plan.updates.length, 0);
});

test("two renames never target the same name", () => {
	const notes = [
		{ path: "R/old1.md", basename: "old1", frontmatter: {}, body: "zotero://select/library/items/KKKKKKK1" },
		{ path: "R/old2.md", basename: "old2", frontmatter: {}, body: "zotero://select/library/items/KKKKKKK2" },
	];
	// A corrupt export with one citekey on two items.
	const exp: BbtExport = {
		items: [
			{ key: "KKKKKKK1", itemType: "book", citationKey: "same", title: "One" },
			{ key: "KKKKKKK2", itemType: "book", citationKey: "same", title: "Two" },
		],
	};
	const plan = planImport(exp, notes, opts());
	assert.deepEqual(plan.updates.map((u) => u.renameTo), ["R/same.md", undefined]);
	assert.equal(plan.report.keyChanges[1].reason, "a note with that name exists");
});

// PR #38 review ------------------------------------------------------------------------------

test("undo never overwrites a note that took a renamed note's old path", async () => {
	const { app, importer, choices } = vault();
	await importer.apply((await importer.plan(choices)).plan, choices);
	await flush();
	// smithOldKey2020 was renamed to smithNewKey2020; a new note now sits at the old path.
	const mine = "My own writing, made after the import.\n";
	app.vault.addFile("References/smithOldKey2020.md", mine);
	const r = await importer.undo(importer.lastBackup);
	await flush();
	assert.deepEqual(r.skipped, ["References/smithNewKey2020.md"]);
	assert.equal(await app.vault.read(app.vault.getAbstractFileByPath("References/smithOldKey2020.md") as TFile), mine, "the new note is untouched");
	assert.ok(app.vault.getAbstractFileByPath("References/smithNewKey2020.md"), "the imported note stays where it is");
});

test("group-library notes are never claimed by a personal item, by title or citekey", () => {
	const notes = [
		{ path: "R/Shared Book.md", basename: "Shared Book", frontmatter: { title: "Shared Book" }, body: "[x](zotero://select/groups/123/items/GGGGGGG1)" },
		{ path: "R/sharedKey.md", basename: "sharedKey", frontmatter: {}, body: "[x](zotero://select/groups/123/items/GGGGGGG2)" },
	];
	const exp: BbtExport = {
		items: [
			{ key: "PPPPPPP1", itemType: "book", citationKey: "personal2020", title: "Shared Book" },
			{ key: "PPPPPPP2", itemType: "book", citationKey: "sharedKey", title: "Other" },
		],
	};
	const plan = planImport(exp, notes, opts({ createMissing: true }));
	assert.equal(plan.updates.length, 0);
	assert.deepEqual(plan.report.groupNotes, ["R/Shared Book.md", "R/sharedKey.md"]);
	assert.deepEqual(plan.creates.map((c) => c.path), ["R/personal2020.md"], "a different item with the same title gets its own note");
	assert.deepEqual(plan.report.notCreated, ["sharedKey"], "and never takes a group note's filename");
});

test("if the report can't be written, the backup still records what to undo", async () => {
	const { app, importer, choices } = vault();
	const create = app.vault.create.bind(app.vault);
	(app.vault as any).create = async (path: string, data: string) => {
		if (path.includes("Zotero import")) throw new Error("disk full");
		return create(path, data);
	};
	await assert.rejects(importer.apply((await importer.plan(choices)).plan, choices), /disk full/);
	(app.vault as any).create = create;
	const r = await importer.undo(importer.lastBackup);
	await flush();
	assert.equal(r.trashed, 1, "the created note is found and removed");
	assert.equal(app.vault.getAbstractFileByPath("References/newItemNoNote2024.md"), null);
	assert.ok(app.vault.getAbstractFileByPath("References/smithOldKey2020.md"), "the rename is reversed");
});

test("an import that fails partway is still the one Undo targets", async () => {
	const { app, library, settings, choices } = vault();
	const targets: string[] = [];
	const importer = new ZoteroImporter(app as any, library, () => settings, "backups", (p) => void targets.push(p));
	const two = { ...choices, renameToCurrentKeys: false };
	const { plan } = await importer.plan(two);
	plan.creates.push({ ...plan.creates[0], path: "References/second.md", extras: { ...plan.creates[0].extras, citekey: "second" } });
	const create = app.vault.create.bind(app.vault);
	(app.vault as any).create = async (path: string, data: string) => {
		if (path === "References/second.md") throw new Error("write failed");
		return create(path, data);
	};
	await assert.rejects(importer.apply(plan, two), /write failed/);
	(app.vault as any).create = create;
	assert.equal(targets.length, 1, "announced before anything was written");
	const r = await importer.undo(targets[0]);
	assert.equal(r.trashed, 1);
});
