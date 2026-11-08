// Settings tab logic against the in-memory Obsidian stand-in (aliased by esbuild.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "obsidian";
import LibraryPlugin from "../src/main";
import { LibrarySettingTab } from "../src/settings";
import { PathSuggest, filePaths, folderPaths } from "../src/ui/PathSuggest";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function setup() {
	const app = new App();
	const plugin = new LibraryPlugin(app as any, { id: "library" } as any);
	await plugin.onload();
	const tab = new LibrarySettingTab(app as any, plugin);
	let rendered = 0;
	tab.display = () => void rendered++;
	return { app, plugin, tab, rendered: () => rendered };
}

test("folder typeahead lists vault folders, prefix matches first", async () => {
	const { app } = await setup();
	app.vault.addFile("Library/References/a.md");
	app.vault.addFile("Inbox/x.md");
	app.vault.addFile("Archive/Old References/b.md");
	const folders = folderPaths(app as any);
	assert.deepEqual(folders, ["Archive", "Archive/Old References", "Inbox", "Library", "Library/References"]);
	const input = Object.assign(new EventTarget(), { value: "" });
	const suggest = new PathSuggest(app as any, input as any, () => folders) as any;
	assert.deepEqual(suggest.suggestionsFor("lib"), ["Library", "Library/References"]);
	assert.deepEqual(suggest.suggestionsFor("refer"), ["Archive/Old References", "Library/References"]);
	assert.equal(suggest.suggestionsFor("").length, 5);
});

test("choosing a suggestion fills the box and fires input so the setting saves", async () => {
	const { app } = await setup();
	const input = Object.assign(new EventTarget(), { value: "Lib" });
	let fired = 0;
	input.addEventListener("input", () => fired++);
	const suggest = new PathSuggest(app as any, input as any, () => ["Library"]);
	suggest.selectSuggestion("Library");
	assert.equal(input.value, "Library");
	assert.equal(fired, 1);
});

test("file typeahead lists only the requested extensions", async () => {
	const { app } = await setup();
	app.vault.addFile("Templates/Reference.md");
	app.vault.addFile("Library.base", "views: []");
	app.vault.addFile("scan.pdf");
	assert.deepEqual(filePaths(app as any, ["md"]), ["Templates/Reference.md"]);
	assert.deepEqual(filePaths(app as any, ["base"]), ["Library.base"]);
});

test("choosing a base sets the folder and matches fields to its and its notes' properties", async () => {
	const { app, plugin, tab, rendered } = await setup();
	app.vault.addFile(
		"Bases/Books.base",
		`filters:\n  and:\n    - file.inFolder("Reading/Books")\nviews:\n  - type: table\n    order: [note.author, note.date, note.Citation Key]\n`
	);
	app.vault.addFile("Reading/Books/one.md", `---\n{"author":"A","date":2020,"Citation Key":"a2020","source":"https://x.example","DOI":"10.1/x"}\n---\n`);
	app.vault.addFile("Elsewhere/other.md", `---\n{"isbn_number":"123"}\n---\n`);
	const reading = await tab.readBase("Bases/Books.base");
	assert.deepEqual(reading.properties.slice(0, 3), ["author", "date", "Citation Key"]);
	assert.ok(reading.properties.includes("DOI") && reading.properties.includes("source"));
	assert.ok(!reading.properties.includes("isbn_number"), "notes outside the base's folder are ignored");

	await (tab as any).useBase("Bases/Books.base");
	const s = plugin.settings;
	assert.equal(s.libraryBase, "Bases/Books.base");
	assert.equal(s.referencesFolder, "Reading/Books");
	assert.equal(s.propertyNames.authors, "author");
	assert.equal(s.propertyNames.year, "date");
	assert.equal(s.propertyNames.citekey, "Citation Key");
	assert.equal(s.propertyNames.doi, "DOI");
	assert.equal(s.propertyNames.url, "source");
	assert.equal(s.propertyNames.isbn, "isbn");
	assert.ok(rendered() > 0);
	assert.equal((plugin as any).data.propertyNames.authors, "author", "saved");
	plugin.unload();
});

test("a missing or broken base reports an error and changes nothing", async () => {
	const { app, plugin, tab } = await setup();
	const before = JSON.stringify(plugin.settings.propertyNames);
	assert.match((await tab.readBase("Nope.base")).error ?? "", /No base at Nope.base/);
	app.vault.addFile("Broken.base", "filters: [unclosed");
	assert.match((await tab.readBase("Broken.base")).error ?? "", /Couldn't read Broken.base/);
	await (tab as any).useBase("Broken.base");
	assert.equal(JSON.stringify(plugin.settings.propertyNames), before);
	assert.equal(plugin.settings.referencesFolder, "References");
	plugin.unload();
});

test("Create base writes a starter base over the references folder and adopts it", async () => {
	const { app, plugin, tab } = await setup();
	app.vault.addFile("Library.base", "views: []");
	plugin.settings.referencesFolder = "Sources";
	await (tab as any).createBase();
	assert.equal(plugin.settings.libraryBase, "Library 1.base");
	const created = app.vault.getAbstractFileByPath("Library 1.base");
	assert.ok(created);
	assert.match(await app.vault.read(created as any), /file\.inFolder\("Sources"\)/);
	assert.equal(plugin.settings.referencesFolder, "Sources");
	plugin.unload();
});

test("after adopting a base, an inbox PDF lands in the base's folder with its attachment", async () => {
	const { app, plugin, tab } = await setup();
	plugin.settings.inboxFolder = "resources/inbox";
	app.vault.addFile(
		"resources/Library.base",
		`filters:\n  and:\n    - file.inFolder("resources/zotero")\n    - file.ext == "md"\n    - file.hasProperty("citekey")\nviews:\n  - type: table\n    order: [authors, year, status, added]\n`
	);
	app.vault.addFile("resources/zotero/existing.md", `---\n{"citekey":"existing","authors":["[[A]]"],"year":2019,"status":"shelved"}\n---\n`);
	await (tab as any).useBase("resources/Library.base");
	assert.equal(plugin.settings.referencesFolder, "resources/zotero");
	assert.equal(plugin.settings.attachmentsFolder, "resources/zotero/attachments", "attachments move with the references folder");

	const { pdf } = await import("obsidian");
	(pdf as any).impl = {
		getDocument: () => ({
			promise: Promise.resolve({
				numPages: 1,
				getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "no identifiers here" }] }) }),
				getMetadata: async () => ({ info: { Title: "Redeemed Personal Agency" } }),
				destroy: async () => undefined,
			}),
		}),
	};
	const file = app.vault.addFile("resources/inbox/scan.pdf", "%PDF");
	const note = await plugin.inbox.process(file);
	assert.ok(note);
	assert.ok(note.path.startsWith("resources/zotero/"), note.path);
	assert.ok(file.path.startsWith("resources/zotero/attachments/"), file.path);
	assert.ok(!app.vault.getAbstractFileByPath("References"), "nothing is created under the old default folder");
	plugin.unload();
});

test("a custom attachments folder outside the references folder is left alone", async () => {
	const { app, plugin, tab } = await setup();
	plugin.settings.attachmentsFolder = "Files/PDFs";
	app.vault.addFile("Lib.base", `filters: 'file.inFolder("Sources")'\n`);
	await (tab as any).useBase("Lib.base");
	assert.equal(plugin.settings.referencesFolder, "Sources");
	assert.equal(plugin.settings.attachmentsFolder, "Files/PDFs");
	plugin.unload();
});
