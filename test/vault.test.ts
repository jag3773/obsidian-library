// Vault-level tests against the in-memory Obsidian stand-in in test/mocks/obsidian.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// "obsidian" is aliased to the mock by esbuild.test.mjs.
import { App, Notice, TFile, http, pdf } from "obsidian";
import { Inbox, fromClip } from "../src/inbox";
import { Library } from "../src/library";
import LibraryPlugin from "../src/main";
import { ReferenceData } from "../src/metadata/types";
import { LibrarySettings, withDefaults } from "../src/settings";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Let pending promises, macrotasks and metadata-cache indexing run. */
async function flush(rounds = 20) {
	for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

function setup(overrides: Partial<LibrarySettings> = {}) {
	const app = new App();
	const settings = withDefaults(overrides);
	const library = new Library(app as any, () => settings);
	const inbox = new Inbox(app as any, library, async (url, headers) => (await import("obsidian")).requestUrl({ url, headers }), () => settings);
	http.calls = [];
	http.handler = async () => ({ status: 404, text: "" });
	Notice.messages = [];
	return { app, settings, library, inbox };
}

async function setupPlugin(overrides: Partial<LibrarySettings> = {}) {
	const { app } = setup();
	const plugin = new LibraryPlugin(app as any, { id: "library" } as any);
	(plugin as any).data = overrides;
	await plugin.onload();
	return { app, plugin };
}

const fm = (app: App, f: TFile) => app.metadataCache.getFileCache(f)?.frontmatter ?? {};

function crossref(works: Record<string, { title: string; family?: string; year?: number }>) {
	http.handler = async ({ url }) => {
		for (const [doi, w] of Object.entries(works)) {
			if (url.includes(encodeURIComponent(doi)))
				return {
					status: 200,
					text: JSON.stringify({
						message: {
							type: "journal-article",
							title: [w.title],
							author: w.family ? [{ given: "Ada", family: w.family }] : [],
							issued: { "date-parts": [[w.year ?? 2020]] },
							DOI: doi,
						},
					}),
				};
		}
		return { status: 404, text: "" };
	};
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => (resolve = r));
	return { promise, resolve };
}

const book = (title: string, extra: Partial<ReferenceData> = {}): ReferenceData => ({
	type: "book",
	title,
	authors: ["Ada Lovelace"],
	familyNames: ["Lovelace"],
	year: 1843,
	source: "test",
	...extra,
});

// ---------------------------------------------------------------- #2

test("#2 concurrent captures get distinct citekeys", async () => {
	const { app, library } = setup({ citekeyPattern: "auth.lower + year", filenameFormat: "{{title}}" });
	const files = await Promise.all([
		library.exclusive(() => library.create(book("One"), "queued")),
		library.exclusive(() => library.create(book("Two"), "queued")),
	]);
	await flush();
	assert.deepEqual(files.map((f) => fm(app, f).citekey).sort(), ["lovelace1843", "lovelace1843a"]);
});

test("#2 concurrent captures with the same filename get distinct paths", async () => {
	const { library } = setup({ filenameFormat: "{{title}}" });
	const files = await Promise.all([
		library.exclusive(() => library.create(book("Example Book"), "queued")),
		library.exclusive(() => library.create(book("Example Book"), "queued")),
	]);
	assert.deepEqual(files.map((f) => f.path).sort(), ["References/Example Book 1.md", "References/Example Book.md"]);
});

test("#2 concurrent Add reference for the same DOI creates one note", async () => {
	const { app, plugin } = await setupPlugin();
	crossref({ "10.1000/same": { title: "Same Paper", family: "Lovelace" } });
	await Promise.all([plugin.addByIdentifier("10.1000/same"), plugin.addByIdentifier("doi:10.1000/same")]);
	await flush();
	assert.equal(app.vault.getMarkdownFiles().length, 1);
	plugin.unload();
});

// ---------------------------------------------------------------- #3

async function draftWithDoi(app: App) {
	const f = app.vault.addFile("References/Draft.md", "");
	await app.fileManager.processFrontMatter(f, (d) => (d.doi = "10.1000/abc"));
	await flush();
	return f;
}

test("#3 control: delayed completion runs when nothing changes", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { app, plugin } = await setupPlugin();
	crossref({ "10.1000/abc": { title: "Remote Title", family: "Lovelace" } });
	const f = await draftWithDoi(app);
	t.mock.timers.tick(2000);
	await flush();
	assert.equal(fm(app, f).title, "Remote Title");
	assert.notEqual(f.path, "References/Draft.md");
	plugin.unload();
});

test("#3 a note moved out of References during the delay is left alone", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { app, plugin } = await setupPlugin();
	crossref({ "10.1000/abc": { title: "Remote Title" } });
	const f = await draftWithDoi(app);
	await app.vault.createFolder("Private");
	await app.fileManager.renameFile(f, "Private/Keep.md");
	t.mock.timers.tick(2000);
	await flush();
	assert.equal(http.calls.length, 0);
	assert.equal(f.path, "Private/Keep.md");
	plugin.unload();
});

test("#3 turning the option off during the delay stops completion", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { app, plugin } = await setupPlugin();
	crossref({ "10.1000/abc": { title: "Remote Title" } });
	const f = await draftWithDoi(app);
	plugin.settings.completeOnPropertyEdit = false;
	t.mock.timers.tick(2000);
	await flush();
	assert.equal(http.calls.length, 0);
	assert.equal(f.path, "References/Draft.md");
	plugin.unload();
});

test("#3 a manual citekey added during the delay is respected", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { app, plugin } = await setupPlugin();
	crossref({ "10.1000/abc": { title: "Remote Title" } });
	const f = await draftWithDoi(app);
	assert.equal((plugin as any).completeTimers.size, 1);
	await app.fileManager.processFrontMatter(f, (d) => (d.citekey = "manual"));
	await flush();
	assert.equal((plugin as any).completeTimers.size, 0, "the pending timer is cancelled, not just skipped");
	t.mock.timers.tick(2000);
	await flush();
	assert.equal(http.calls.length, 0);
	assert.equal(f.path, "References/Draft.md");
	plugin.unload();
});

test("#3 a citekey added while the lookup is in flight prevents the write", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { app, plugin } = await setupPlugin();
	const gate = deferred();
	const f = await draftWithDoi(app);
	crossref({ "10.1000/abc": { title: "Remote Title" } });
	const respond = http.handler;
	http.handler = async (p) => {
		await gate.promise;
		return respond(p);
	};
	t.mock.timers.tick(2000);
	await flush();
	assert.equal(http.calls.length, 1);
	await app.fileManager.processFrontMatter(f, (d) => (d.citekey = "manual"));
	await flush();
	gate.resolve();
	await flush();
	assert.equal(f.path, "References/Draft.md");
	assert.equal(fm(app, f).title, undefined);
	plugin.unload();
});

// ---------------------------------------------------------------- #4

test("#4 control: an inbox file is processed after the settle delay", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { app, plugin } = await setupPlugin();
	app.vault.addFile("Inbox/.keep", "");
	const clip = await app.vault.create("Inbox/clip.md", `---\n{"url":"https://example.com/a"}\n---\n`);
	t.mock.timers.tick(750);
	await flush();
	assert.ok(http.calls.length > 0);
	assert.ok(clip.path.startsWith("References/"));
	plugin.unload();
});

test("#4 unloading during the inbox settle delay cancels processing", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { app, plugin } = await setupPlugin();
	app.vault.addFile("Inbox/.keep", "");
	const clip = await app.vault.create("Inbox/clip.md", `---\n{"url":"https://example.com/a"}\n---\n`);
	assert.ok((plugin as any).timers.size > 0);
	plugin.unload();
	assert.equal((plugin as any).timers.size, 0, "unload clears pending timers");
	t.mock.timers.tick(750);
	await flush();
	assert.equal(http.calls.length, 0);
	assert.equal(clip.path, "Inbox/clip.md");
});

test("#4 unloading during a metadata lookup prevents vault writes", async () => {
	const { app, plugin } = await setupPlugin({ completeOnPropertyEdit: false });
	const gate = deferred();
	const f = await draftWithDoi(app);
	crossref({ "10.1000/abc": { title: "Remote Title" } });
	const respond = http.handler;
	http.handler = async (p) => {
		await gate.promise;
		return respond(p);
	};
	const run = plugin.completeFromProperties(f, true);
	await flush();
	plugin.unload();
	gate.resolve();
	await run;
	await flush();
	assert.equal(f.path, "References/Draft.md");
	assert.equal(fm(app, f).title, undefined);
	assert.ok(!Notice.messages.some((m) => /unloaded/.test(m)), "cancellation is silent");
});

// ---------------------------------------------------------------- #6 / #7

test("#6 attachment names use author and year from the note", async () => {
	const { app, library } = setup({ attachmentFilenameFormat: "{{author}}-{{year}}-{{title}}" });
	const note = app.vault.addFile(
		"References/key.md",
		`---\n${JSON.stringify({ citekey: "key", title: "Example Book", authors: ["[[Ada Lovelace]]"], year: 1843 })}\n---\n`
	);
	const file = app.vault.addFile("Inbox/scan.pdf", "%PDF");
	await library.exclusive(() => library.attach(note, file));
	assert.equal(file.path, "References/attachments/Lovelace-1843-Example Book.pdf");
});

test("#6 attachment names honour custom property names", async () => {
	const base = withDefaults({});
	const { app, library } = setup({
		attachmentFilenameFormat: "{{author}}-{{year}}-{{title}}",
		propertyNames: { ...base.propertyNames, authors: "creator", year: "date", title: "name" },
	});
	const note = app.vault.addFile(
		"References/key.md",
		`---\n${JSON.stringify({ citekey: "key", name: "Example Book", creator: "Lovelace, Ada", date: "1843-01-01" })}\n---\n`
	);
	const file = app.vault.addFile("Inbox/scan.pdf", "%PDF");
	await library.exclusive(() => library.attach(note, file));
	assert.equal(file.path, "References/attachments/Lovelace-1843-Example Book.pdf");
});

test("#6 a PDF filed with a brand-new note is named from its metadata", async () => {
	const { app, inbox } = setup({ attachmentFilenameFormat: "{{author}}-{{year}}-{{citekey}}" });
	crossref({ "10.1000/xyz": { title: "Fresh Paper", family: "Lovelace", year: 1843 } });
	pdf.impl = {
		getDocument: () => ({
			promise: Promise.resolve({
				numPages: 1,
				getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "doi:10.1000/xyz" }] }) }),
				getMetadata: async () => ({ info: {} }),
				destroy: async () => undefined,
			}),
		}),
	};
	const file = app.vault.addFile("Inbox/scan.pdf", "%PDF");
	const note = await inbox.process(file);
	assert.ok(note);
	assert.equal(file.path, "References/attachments/Lovelace-1843-lovelaceFreshPaper1843.pdf");
});

test("#7 attachment links include the path when the basename isn't unique", async () => {
	const { app, library } = setup();
	const note = app.vault.addFile("References/key.md", `---\n{"citekey":"key","title":"T"}\n---\n`);
	const unrelated = app.vault.addFile("References/key.pdf", "%PDF other");
	const file = app.vault.addFile("Inbox/new.pdf", "%PDF");
	await library.exclusive(() => library.attach(note, file));
	await library.exclusive(() => library.attach(note, file)); // re-attaching doesn't duplicate
	await flush();
	const props = fm(app, note);
	assert.equal(file.path, "References/attachments/key.pdf");
	assert.equal(props.pdf, "[[References/attachments/key.pdf]]");
	assert.deepEqual(props.attachments, ["[[References/attachments/key.pdf]]"]);
	const target = (props.pdf as string).slice(2, -2);
	assert.equal(app.metadataCache.getFirstLinkpathDest(target, note.path), file);
	assert.notEqual(app.metadataCache.getFirstLinkpathDest(target, note.path), unrelated);
});

test("#7 control: a unique basename keeps a short link", async () => {
	const { app, library } = setup();
	const note = app.vault.addFile("References/key.md", `---\n{"citekey":"key"}\n---\n`);
	const file = app.vault.addFile("Inbox/new.pdf", "%PDF");
	await library.exclusive(() => library.attach(note, file));
	await flush();
	assert.equal(fm(app, note).pdf, "[[key.pdf]]");
});

// ---------------------------------------------------------------- #9

test("#9 ISBN-10 and ISBN-13 forms are the same reference, both ways", () => {
	const { app, library } = setup();
	const ten = app.vault.addFile("References/a.md", `---\n{"isbn":"0-14-312837-X"}\n---\n`);
	assert.equal(library.findExisting({ isbn: "9780143128373" }), ten);
	const { app: app2, library: library2 } = setup();
	const thirteen = app2.vault.addFile("References/b.md", `---\n{"isbn":"978-0-14-312837-3"}\n---\n`);
	assert.equal(library2.findExisting({ isbn: "014312837X" }), thirteen);
	assert.equal(library2.findExisting({ isbn: "0143128370" }), null, "invalid checksum");
	assert.equal(library2.findExisting({ isbn: "9791034304370" }), null, "979 is distinct");
});

// ---------------------------------------------------------------- #10

function inboxWithDuplicate(status: number) {
	const env = setup();
	env.app.vault.addFile("References/existing.md", `---\n{"citekey":"existing","url":"https://example.com/item"}\n---\n`);
	const clip = env.app.vault.addFile("Inbox/clip.md", `---\n{"source":"https://example.com/item","title":"Clip"}\n---\n`);
	http.handler = async () => ({ status, text: status === 200 ? `<title>Item</title>` : "" });
	return { ...env, clip };
}

test("#10 an inbox duplicate is caught when the lookup fails", async () => {
	const { inbox, clip } = inboxWithDuplicate(503);
	assert.equal(await inbox.process(clip), null);
	assert.equal(clip.path, "Inbox/clip.md");
	assert.ok(Notice.messages.some((m) => m.includes("matches existing existing")));
});

test("#10 an inbox duplicate is caught when the lookup succeeds", async () => {
	const { inbox, clip } = inboxWithDuplicate(200);
	assert.equal(await inbox.process(clip), null);
	assert.equal(clip.path, "Inbox/clip.md");
});

test("#10 control: a new URL is filed even when the lookup fails", async () => {
	const { app, inbox } = setup();
	const clip = app.vault.addFile("Inbox/clip.md", `---\n{"url":"https://example.com/new","title":"New Thing"}\n---\n`);
	http.handler = async () => ({ status: 503, text: "" });
	const filed = await inbox.process(clip);
	assert.ok(filed);
	assert.ok(clip.path.startsWith("References/"));
});

// ---------------------------------------------------------------- PR #13 review

test("#4 unloading while a template is being read creates nothing", async () => {
	const { app, plugin } = await setupPlugin({ templatePath: "Templates/reference.md" });
	const template = app.vault.addFile("Templates/reference.md", "# {{title}}\n");
	crossref({ "10.1000/tpl": { title: "Remote Title", family: "Lovelace" } });
	const gate = deferred();
	let reading = false;
	const read = app.vault.read.bind(app.vault);
	app.vault.read = async (f: TFile) => {
		if (f === template) {
			reading = true;
			await gate.promise;
		}
		return read(f);
	};
	const run = plugin.addByIdentifier("10.1000/tpl");
	for (let i = 0; i < 50 && !reading; i++) await flush(1);
	assert.ok(reading, "the template read started");
	plugin.unload();
	gate.resolve();
	await run;
	await flush();
	assert.deepEqual(
		app.vault.getMarkdownFiles().map((f) => f.path),
		["Templates/reference.md"]
	);
});

test("#6 a second PDF for a just-reserved note is still named from metadata", async () => {
	const { app, inbox } = setup({ attachmentFilenameFormat: "{{author}}-{{year}}-{{title}}" });
	crossref({ "10.1000/xyz": { title: "Fresh Paper", family: "Lovelace", year: 1843 } });
	pdf.impl = {
		getDocument: () => ({
			promise: Promise.resolve({
				numPages: 1,
				getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "doi:10.1000/xyz" }] }) }),
				getMetadata: async () => ({ info: {} }),
				destroy: async () => undefined,
			}),
		}),
	};
	const a = app.vault.addFile("Inbox/a.pdf", "%PDF a");
	const b = app.vault.addFile("Inbox/b.pdf", "%PDF b");
	const notes = await Promise.all([inbox.process(a), inbox.process(b)]);
	assert.equal(notes[0], notes[1], "the second PDF attaches to the first note");
	assert.deepEqual(
		[a.path, b.path].sort(),
		["References/attachments/Lovelace-1843-Fresh Paper 1.pdf", "References/attachments/Lovelace-1843-Fresh Paper.pdf"]
	);
});

test("#10 an original capture URL still matches after the note took a canonical URL", async (t) => {
	const { app, inbox } = setup();
	const first = app.vault.addFile("Inbox/first.md", `---\n{"source":"https://example.com/original","title":"Clip"}\n---\n`);
	http.handler = async () => ({
		status: 200,
		text: `<meta property="og:url" content="https://example.com/canonical"><title>Item</title>`,
	});
	const filed = await inbox.process(first);
	assert.ok(filed);
	await flush();
	assert.equal(fm(app, first).url, "https://example.com/canonical", "mapped url is the canonical one");
	// Let the short-lived reservation expire, so only the note's own properties can match.
	t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 60_000 });

	const second = app.vault.addFile("Inbox/second.md", `---\n{"source":"https://example.com/original","title":"Again"}\n---\n`);
	http.handler = async () => ({ status: 503, text: "" });
	assert.equal(await inbox.process(second), null);
	assert.equal(second.path, "Inbox/second.md");
	assert.equal(app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("References/")).length, 1);
});

test("#10 the original capture URL also matches before the cache indexes the note", async () => {
	const { app, library } = setup();
	const clip = app.vault.addFile("Inbox/first.md", "");
	const canonical = book("Item", { url: "https://example.com/canonical" });
	const found = await library.exclusive(async () => {
		await library.complete(clip, canonical, "shelved", ["https://example.com/original"]);
		// No macrotask has run, so the metadata cache hasn't indexed the new properties.
		assert.equal(fm(app, clip).url, undefined);
		return library.findExisting({ url: "https://example.com/original" });
	});
	assert.equal(found, clip);
});

// Rich web metadata ------------------------------------------------------------------------

const webFixture = (name: string) => readFileSync(`test/fixtures/web/${name}`, "utf8");

test("a Goodreads clip is filed with author, publication date, abstract and ISBN", async () => {
	const { app, inbox } = setup();
	const url = "https://www.goodreads.com/book/show/54493401-project-hail-mary";
	const clip = app.vault.addFile("Inbox/clip.md", `---\n${JSON.stringify({ source: url, title: "Project Hail Mary by Andy Weir | Goodreads" })}\n---\nclipped text\n`);
	http.handler = async (p) => (p.url === url ? { status: 200, text: webFixture("goodreads-book.html") } : { status: 404, text: "" });
	assert.ok(await inbox.process(clip));
	await flush();
	const props = fm(app, clip);
	assert.equal(props.title, "Project Hail Mary", "the looked-up title replaces the clipper's page title");
	assert.equal(props.source, url, "the clip's URL property is kept");
	assert.deepEqual(props.authors, ["[[Andy Weir]]"]);
	assert.equal(props.published, "2021-05-04");
	assert.equal(props.year, 2021);
	assert.match(props.abstract, /^Ryland Grace is the sole survivor/);
	assert.equal(props.isbn, "9780593135204");
	assert.equal(props.type, "book");
	assert.match(String(props.citekey), /^weir.*2021$/i);
});

test("a site that blocks the plugin falls back on what Web Clipper saved", async () => {
	const { app, inbox } = setup();
	const url = "https://www.kobo.com/us/en/ebook/project-hail-mary";
	const clip = app.vault.addFile(
		"Inbox/kobo.md",
		`---\n${JSON.stringify({
			title: "Project Hail Mary",
			source: url,
			author: ["[[Andy Weir]]"],
			published: "2021-05-04",
			description: "A lone astronaut must save the earth from disaster.",
		})}\n---\n`
	);
	// Kobo answers automated requests with a bot check.
	http.handler = async () => ({ status: 403, text: "<html><head><title>Challenged | Kobo.com</title></head></html>" });
	assert.ok(await inbox.process(clip));
	await flush();
	const props = fm(app, clip);
	assert.deepEqual(props.authors, ["[[Andy Weir]]"]);
	assert.equal(props.published, "2021-05-04");
	assert.equal(props.abstract, "A lone astronaut must save the earth from disaster.");
	assert.match(String(props.citekey), /^weir.*2021$/i);
	assert.ok(clip.path.startsWith("References/"));
});

test("a bot check served with status 200 isn't mistaken for the page", async () => {
	const { app, inbox } = setup();
	const clip = app.vault.addFile("Inbox/c.md", `---\n{"source":"https://shop.example/item","title":"Real Title"}\n---\n`);
	http.handler = async () => ({ status: 200, text: `<html><head><title>Just a moment...</title><meta name="description" content="Checking your browser"></head></html>` });
	assert.ok(await inbox.process(clip));
	await flush();
	assert.equal(fm(app, clip).title, "Real Title");
	assert.equal(fm(app, clip).abstract, undefined);
});

test("a GitHub clip gets the repository's name, owner, creation date and description", async () => {
	const { app, inbox } = setup();
	const url = "https://github.com/jag3773/obsidian-library";
	// What Web Clipper's default template saves for this page.
	const clip = app.vault.addFile(
		"Inbox/GitHub - jag3773_obsidian-library.md",
		`---\n${JSON.stringify({
			title: "GitHub - jag3773/obsidian-library: A full featured library plugin for Obsidian",
			source: url,
			author: null,
			published: null,
			description: "A full featured library plugin for Obsidian. Contribute to jag3773/obsidian-library development by creating an account on GitHub.",
		})}\n---\n`
	);
	http.handler = async (p) =>
		p.url === "https://api.github.com/repos/jag3773/obsidian-library"
			? { status: 200, text: webFixture("github-repo.json") }
			: p.url === "https://api.github.com/users/jag3773"
				? { status: 200, text: webFixture("github-user.json") }
				: { status: 404, text: "" };
	assert.ok(await inbox.process(clip));
	await flush();
	const props = fm(app, clip);
	assert.equal(props.title, "obsidian-library");
	assert.deepEqual(props.authors, ["[[Jesse Griffin]]"]);
	assert.equal(props.published, "2026-11-08");
	assert.equal(props.abstract, "A full featured library plugin for Obsidian");
	assert.equal(props.type, "software");
	assert.equal(props.journal, "GitHub");
	assert.equal(props.status, "shelved");
});

test("values the user set on a note are never replaced when completing it by hand", async () => {
	const { app, library } = setup();
	const note = app.vault.addFile("References/n.md", `---\n{"title":"Mine","abstract":"My summary"}\n---\n`);
	await flush();
	const data: ReferenceData = { type: "book", title: "Theirs", authors: ["A B"], familyNames: ["B"], abstract: "Theirs", source: "test" };
	await library.exclusive(() => library.complete(note, data));
	await flush();
	assert.equal(fm(app, note).title, "Mine");
	assert.equal(fm(app, note).abstract, "My summary");
	assert.deepEqual(fm(app, note).authors, ["[[A B]]"]);
});

test("settings that map the year and the date to one property keep the full date", async () => {
	const { app, library, settings } = setup();
	settings.propertyNames.year = "date";
	settings.propertyNames.published = "date";
	const data: ReferenceData = { type: "book", title: "T", authors: [], familyNames: [], date: "2021-05-04", year: 2021, source: "test" };
	const note = await library.exclusive(() => library.create(data, "queued"));
	await flush();
	assert.equal(fm(app, note).date, "2021-05-04");
});

test("clip metadata fills what the page lacks, under the library's property names", async () => {
	const { app, inbox } = setup();
	const clip = app.vault.addFile("Inbox/c.md", `---\n{"source":"https://blog.example/p","title":"Clip","date":"March 3, 2024","summary":"What it says."}\n---\n`);
	http.handler = async () => ({ status: 200, text: `<html><head><title>Post</title></head></html>` });
	assert.ok(await inbox.process(clip));
	await flush();
	assert.equal(fm(app, clip).published, "2024-03-03");
	assert.equal(fm(app, clip).abstract, "What it says.");
	assert.equal(fm(app, clip).title, "Post");
});

test("a page with no title doesn't replace the clip's title with its URL", async () => {
	const { app, inbox } = setup();
	const clip = app.vault.addFile("Inbox/c.md", `---\n{"source":"https://blog.example/p","title":"Real Title"}\n---\n`);
	http.handler = async () => ({ status: 200, text: `<html><body>x</body></html>` });
	assert.ok(await inbox.process(clip));
	await flush();
	assert.equal(fm(app, clip).title, "Real Title");
});

test("clip authors are read from lists, [[links]] with aliases, or a plain name", () => {
	const props = withDefaults({}).propertyNames;
	assert.deepEqual(fromClip({ author: ["[[Andy Weir|Weir]]", "Jo March"] }, props, "x").authors, ["Andy Weir", "Jo March"]);
	assert.deepEqual(fromClip({ author: "[[A One]], [[B Two]]" }, props, "x").authors, ["A One", "B Two"]);
	assert.deepEqual(fromClip({ author: "Plain Name" }, props, "x").authors, ["Plain Name"]);
	assert.equal(fromClip({ published: "2021-05-04" }, props, "x").date, "2021-05-04");
	assert.equal(fromClip({}, props, "Fallback").title, "Fallback");
});
