// #16: references without a lookup, and refreshing one from a lookup with a review.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App, Notice, TFile, http } from "obsidian";
import { Library } from "../src/library";
import LibraryPlugin from "../src/main";
import { compareProperties, manualReference } from "../src/manual";
import { ReferenceData } from "../src/metadata/types";
import { withDefaults } from "../src/settings";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function flush(rounds = 20) {
	for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

const fm = (app: App, f: TFile) => app.metadataCache.getFileCache(f)?.frontmatter ?? {};

async function setupPlugin(data: Record<string, unknown> = {}) {
	const app = new App();
	const plugin = new LibraryPlugin(app as any, { id: "library" } as any);
	(plugin as any).data = data;
	await plugin.onload();
	http.calls = [];
	http.handler = async () => ({ status: 404, text: "" });
	Notice.messages = [];
	return { app, plugin };
}

const form = (over: Partial<Parameters<typeof manualReference>[0]>) => manualReference({ type: "book", title: "", authors: "", date: "", identifier: "", ...over });

test("the manual form: title required, names in any form, a date or year, an optional identifier", () => {
	assert.match(form({}).error ?? "", /title/);
	const { data } = form({
		type: "presentation",
		title: "  The Great   Commission ",
		authors: "Jane Doe\nGarcía Márquez, Gabriel; {Example Church}",
		date: "March 17, 2024",
		identifier: "978-0-14-312837-3",
	});
	assert.equal(data?.title, "The Great Commission");
	assert.equal(data?.type, "presentation");
	assert.deepEqual(data?.authors, ["Jane Doe", "Gabriel García Márquez", "Example Church"]);
	assert.deepEqual(data?.familyNames, ["Doe", "García Márquez", "Example Church"]);
	assert.equal(data?.date, "2024-03-17");
	assert.equal(data?.year, 2024);
	assert.equal(data?.isbn, "9780143128373");
	assert.match(form({ title: "T", date: "someday" }).error ?? "", /isn't a date/);
	assert.match(form({ title: "T", identifier: "not one" }).error ?? "", /doesn't look like/);
	assert.equal(form({ title: "T", identifier: "10.1000/xyz" }).data?.doi, "10.1000/xyz");
	assert.equal(form({ title: "T", identifier: "arXiv:2303.08774" }).data?.url, "https://arxiv.org/abs/2303.08774");
	assert.equal(form({ type: "nonsense", title: "T" }).data?.type, "document");
});

test("New reference creates a usable note and a stable citekey without a network request", async () => {
	const { app, plugin } = await setupPlugin();
	const { data } = form({ title: "Sermon on the Mount Notes", authors: "Ana Lima", date: "1999", type: "presentation" });
	const note = (await plugin.createManualReference(data!))!;
	await flush();
	assert.equal(http.calls.length, 0, "no lookup");
	assert.equal(note.path, "References/limaSermonMountNotes1999.md");
	const props = fm(app, note);
	assert.equal(props.citekey, "limaSermonMountNotes1999");
	assert.equal(props.type, "presentation");
	assert.deepEqual(props.authors, ["[[Ana Lima]]"]);
	assert.equal(props.published, "1999");
	assert.equal(props.status, "queued");
	assert.deepEqual(app.workspace.opened, [note], "the note opens for the rest of its properties");
});

test("missing authors or dates and corporate creators still get citekeys", async () => {
	const { app, plugin } = await setupPlugin({ authorsAsLinks: false });
	const anon = (await plugin.createManualReference(form({ title: "Untitled Field Notes" }).data!))!;
	const corp = (await plugin.createManualReference(form({ title: "Annual Report", authors: "{Example Church}", date: "2023" }).data!))!;
	await flush();
	assert.equal(fm(app, anon).citekey, "UntitledFieldNotes");
	assert.equal(fm(app, corp).citekey, "examplechurchAnnualReport2023");
	assert.deepEqual(fm(app, corp).authors, ["Example Church"], "an organization name that splits as one stays plain");
});

test("custom property names are used for manual references", async () => {
	const names = { ...withDefaults({}).propertyNames, authors: "author", published: "date" };
	const { app, plugin } = await setupPlugin({ propertyNames: names });
	const note = (await plugin.createManualReference(form({ title: "T", authors: "Jo March", date: "2001-02" }).data!))!;
	await flush();
	assert.deepEqual(fm(app, note).author, ["[[Jo March]]"]);
	assert.equal(fm(app, note).date, "2001-02");
	assert.equal(fm(app, note).authors, undefined);
});

test("a manual reference with a known identifier opens the existing note instead", async () => {
	const { app, plugin } = await setupPlugin();
	const existing = app.vault.addFile("References/old.md", `---\n{"citekey":"old","isbn":"9780143128373"}\n---\n`);
	const r = await plugin.createManualReference(form({ title: "Dup", identifier: "014312837X" }).data!);
	assert.equal(r, existing);
	assert.equal(app.vault.getMarkdownFiles().length, 1);
});

test("Complete current reference on a note with no identifier names it from its properties, offline", async () => {
	const { app, plugin } = await setupPlugin();
	const note = app.vault.addFile("References/draft.md", `---\n{"title":"Talk on Prayer","authors":["[[Bo Chen]]"],"year":2015}\n---\nmy notes\n`);
	await plugin.completeFromProperties(note, true);
	await flush();
	assert.equal(http.calls.length, 0);
	assert.equal(note.path, "References/chenTalkPrayer2015.md");
	assert.equal(fm(app, note).citekey, "chenTalkPrayer2015");
	assert.equal(fm(app, note).status, "queued");
	assert.match(await app.vault.read(note), /my notes\n$/, "the body is untouched");

	const blank = app.vault.addFile("References/blank.md", `---\n{"authors":["[[Bo Chen]]"]}\n---\n`);
	await plugin.completeFromProperties(blank, true);
	await flush();
	assert.equal(blank.path, "References/blank.md");
	assert.equal(fm(app, blank).citekey, undefined);
	assert.match(Notice.messages.at(-1) ?? "", /add a title/);

	const outside = app.vault.addFile("Notes/x.md", `---\n{"title":"X"}\n---\n`);
	await plugin.completeFromProperties(outside, true);
	assert.equal(outside.path, "Notes/x.md");
	assert.match(Notice.messages.at(-1) ?? "", /move the note into References/);
});

test("refresh: fills empty fields, offers replacements unticked, never touches citekey, status or body", async () => {
	const app = new App();
	const settings = withDefaults({});
	const library = new Library(app as any, () => settings);
	const note = app.vault.addFile(
		"References/k.md",
		`---\n${JSON.stringify({ citekey: "k", title: "My Corrected Title", isbn: "9780143128373", status: "reading", authors: ["[[Norman Doidge]]"] })}\n---\nbody\n`
	);
	const data: ReferenceData = {
		type: "book",
		title: "The Brain's Way of Healing",
		authors: ["Norman Doidge"],
		familyNames: ["Doidge"],
		publisher: "Penguin",
		year: 2016,
		isbn: "9780143128373",
		source: "Open Library",
	};
	const changes = library.refreshChanges(note, data);
	const by = Object.fromEntries(changes.map((c) => [c.property, c]));
	assert.deepEqual(Object.keys(by).sort(), ["publisher", "title", "type", "year"]);
	assert.equal(by.title.fills, false, "the user's title is offered, not applied");
	assert.equal(by.publisher.fills, true);
	await library.exclusive(() => library.applyChanges(note, changes.filter((c) => c.fills)));
	await flush();
	const props = fm(app, note);
	assert.equal(props.title, "My Corrected Title");
	assert.equal(props.publisher, "Penguin");
	assert.equal(props.status, "reading");
	assert.equal(props.citekey, "k");
	assert.match(await app.vault.read(note), /\nbody\n$/);
});

test("compareProperties ignores equal values in another form and fields it wasn't given", () => {
	const changes = compareProperties({ year: "2016", status: "x" }, { year: 2016, status: "y", title: "T" }, [
		["year", "Year"],
		["title", "Title"],
	]);
	assert.deepEqual(
		changes.map((c) => c.property),
		["title"]
	);
});
