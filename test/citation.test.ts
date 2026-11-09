// #15: lookup -> note -> citation record keeps what each type needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App, TFile } from "obsidian";
import { CslItem, missingFields, noteToCsl } from "../src/citation";
import { Library } from "../src/library";
import { parseCsl } from "../src/metadata/crossref";
import { parseOpenLibrary } from "../src/metadata/openlibrary";
import { ReferenceData } from "../src/metadata/types";
import { parseWebpage } from "../src/metadata/webpage";
import { withDefaults } from "../src/settings";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function flush(rounds = 20) {
	for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

/** Create the note the plugin would, then read it back as a citation record. */
async function roundTrip(data: ReferenceData, overrides = {}): Promise<{ item: CslItem; fm: Record<string, any>; note: TFile }> {
	const app = new App();
	const settings = withDefaults(overrides);
	const library = new Library(app as any, () => settings);
	const note = await library.exclusive(() => library.create(data, "queued"));
	await flush();
	const fm = app.metadataCache.getFileCache(note)?.frontmatter ?? {};
	return { item: noteToCsl(fm, settings.propertyNames)!, fm, note };
}

test("journal article: container, volume, issue, pages, ISSN, DOI and full date survive", async () => {
	const data = parseCsl(
		{
			type: "journal-article",
			title: ["Creating Shared Value"],
			author: [
				{ given: "Michael E.", family: "Porter" },
				{ given: "Mark R.", family: "Kramer" },
			],
			issued: { "date-parts": [[2011, 1, 15]] },
			"container-title": ["Harvard Business Review"],
			volume: 89,
			issue: "1/2",
			page: "62-77",
			ISSN: ["0017-8012"],
			language: "en",
			DOI: "10.1000/hbr",
		},
		"10.1000/hbr",
		"Crossref"
	)!;
	const { item, fm } = await roundTrip(data);
	assert.deepEqual(fm.authors, ["[[Michael E. Porter]]", "[[Mark R. Kramer]]"]);
	assert.equal(fm.volume, "89");
	assert.equal(fm.pages, "62-77");
	assert.equal(fm.published, "2011-01-15");
	assert.equal(item.type, "article-journal");
	assert.deepEqual(item.author, [
		{ family: "Porter", given: "Michael E." },
		{ family: "Kramer", given: "Mark R." },
	]);
	assert.deepEqual(item.issued, { "date-parts": [[2011, 1, 15]] });
	assert.equal(item["container-title"], "Harvard Business Review");
	assert.equal(item.issue, "1/2");
	assert.equal(item.page, "62-77");
	assert.equal(item.ISSN, "0017-8012");
	assert.equal(item.DOI, "10.1000/hbr");
	assert.equal(item.language, "en");
	assert.deepEqual(missingFields(item), []);
});

test("book chapter: the book, its editors and the pages are kept apart from the authors", async () => {
	const data = parseCsl(
		{
			type: "book-chapter",
			title: ["On Method"],
			author: [{ given: "Ana", family: "Lima" }],
			editor: [{ given: "Gabriel", family: "García Márquez" }],
			"container-title": ["Collected Essays"],
			publisher: "Example Press",
			"publisher-place": "Chicago",
			page: "1-20",
			issued: { "date-parts": [[2020]] },
		},
		"10.1/ch",
		"Crossref"
	)!;
	const { item, fm } = await roundTrip(data);
	assert.deepEqual(fm.authors, ["[[Ana Lima]]"]);
	assert.deepEqual(fm.editors, ["[[Gabriel García Márquez|García Márquez, Gabriel]]"], "a two-word family name keeps its split");
	assert.equal(item.type, "chapter");
	assert.deepEqual(item.editor, [{ family: "García Márquez", given: "Gabriel" }]);
	assert.equal(item["container-title"], "Collected Essays");
	assert.equal(item["publisher-place"], "Chicago");
	assert.deepEqual(missingFields(item), []);
});

test("edited book: editors only, and the citekey uses them", async () => {
	const data = parseCsl(
		{ type: "edited-book", title: ["Readings"], editor: [{ given: "Jo", family: "March" }], publisher: "P", issued: { "date-parts": [[1999]] } },
		"10.1/eb",
		"Crossref"
	)!;
	const { item, fm, note } = await roundTrip(data);
	assert.equal(fm.authors, undefined);
	assert.deepEqual(fm.editors, ["[[Jo March]]"]);
	assert.match(note.basename, /^march/);
	assert.deepEqual(missingFields(item), [], "a book with editors and no authors is complete");
});

test("translated book: translators never become authors", async () => {
	const data = parseCsl(
		{
			type: "book",
			title: ["Ficciones"],
			author: [{ given: "Jorge Luis", family: "Borges" }],
			translator: [{ given: "Andrew", family: "Hurley" }],
			publisher: "Penguin",
			edition: "2",
			issued: { "date-parts": [[1998]] },
		},
		"10.1/f",
		"Crossref"
	)!;
	const { item, fm } = await roundTrip(data);
	assert.deepEqual(fm.authors, ["[[Jorge Luis Borges]]"]);
	assert.deepEqual(fm.translators, ["[[Andrew Hurley]]"]);
	assert.deepEqual(item.translator, [{ family: "Hurley", given: "Andrew" }]);
	assert.equal(item.edition, "2");
});

test("book from Open Library: publisher, place, ISBN and date", async () => {
	const data = parseOpenLibrary(
		{
			"ISBN:9780143128373": {
				title: "The Brain's Way of Healing",
				authors: [{ name: "Norman Doidge" }],
				publishers: [{ name: "Penguin Books" }],
				publish_places: [{ name: "New York" }],
				publish_date: "January 26, 2016",
			},
		},
		"9780143128373"
	)!;
	const { item } = await roundTrip(data);
	assert.equal(item.type, "book");
	assert.equal(item.publisher, "Penguin Books");
	assert.equal(item["publisher-place"], "New York");
	assert.equal(item.ISBN, "9780143128373");
	assert.deepEqual(item.issued, { "date-parts": [[2016, 1, 26]] });
	assert.deepEqual(missingFields(item), []);
});

test("thesis and report: the institution is the publisher", async () => {
	for (const [cslType, ours] of [
		["dissertation", "thesis"],
		["report", "report"],
	]) {
		const data = parseCsl(
			{ type: cslType, title: ["T"], author: [{ given: "A", family: "B" }], publisher: "Univ. X", issued: { "date-parts": [[2001, 5]] } },
			"10.1/t",
			"Crossref"
		)!;
		const { item } = await roundTrip(data);
		assert.equal(data.type, ours);
		assert.equal(item.type, ours);
		assert.deepEqual(item.issued, { "date-parts": [[2001, 5]] });
		assert.deepEqual(missingFields(item), []);
	}
});

test("web page: site, URL, language and the date it was read", async () => {
	const page = parseWebpage(
		`<html lang="en"><head><meta property="og:site_name" content="Example"><meta name="citation_language" content="en">
		<script type="application/ld+json">{"@type":"WebPage","name":"How it works","datePublished":"2024-02-01"}</script></head></html>`,
		"https://example.com/how"
	);
	const { item } = await roundTrip({ ...page, accessed: "2026-11-08" });
	assert.equal(item.type, "webpage");
	assert.equal(item["container-title"], "Example");
	assert.equal(item.URL, "https://example.com/how");
	assert.deepEqual(item.accessed, { "date-parts": [[2026, 11, 8]] });
	assert.equal(item.language, "en");
	assert.deepEqual(missingFields(item), []);
});

test("organizations stay whole and fields are written only when the source has them", async () => {
	const data: ReferenceData = {
		type: "report",
		title: "Global Report",
		authors: ["Elevation Worship"],
		familyNames: ["Elevation Worship"],
		names: { authors: [{ literal: "Elevation Worship" }] },
		year: 2020,
		source: "test",
	};
	const { item, fm } = await roundTrip(data, { authorsAsLinks: false });
	assert.deepEqual(fm.authors, ["{Elevation Worship}"]);
	assert.deepEqual(item.author, [{ literal: "Elevation Worship" }]);
	for (const k of ["volume", "issue", "pages", "editors", "translators", "place", "edition"]) assert.equal(k in fm, false, k);
	assert.deepEqual(missingFields(item), []);
});

test("custom property names are honored both ways", async () => {
	const data = parseCsl(
		{ type: "journal-article", title: ["T"], author: [{ given: "A", family: "B" }], volume: 3, "container-title": ["J"], issued: { "date-parts": [[2000]] } },
		"10.1/x",
		"Crossref"
	)!;
	const names = { ...withDefaults({}).propertyNames, volume: "vol", journal: "publicationTitle", authors: "author" };
	const { item, fm } = await roundTrip(data, { propertyNames: names });
	assert.equal(fm.vol, "3");
	assert.equal(fm.publicationTitle, "J");
	assert.equal(item.volume, "3");
	assert.equal(item["container-title"], "J");
	assert.deepEqual(item.author, [{ family: "B", given: "A" }]);
});

test("records missing what their type needs are reported", () => {
	const p = withDefaults({}).propertyNames;
	assert.equal(noteToCsl({ title: "No key" }, p), undefined);
	const item = noteToCsl({ citekey: "k", type: "book", title: "T" }, p)!;
	assert.deepEqual(missingFields(item), ["author or editor", "issued", "publisher"]);
	assert.deepEqual(missingFields(noteToCsl({ citekey: "k", type: "webpage" }, p)!), ["title", "URL"]);
	assert.equal(noteToCsl({ citekey: "k", type: "article", journal: "[[Nature|the journal]]", year: 2001 }, p)?.["container-title"], "Nature");
});

// PR #38 review ------------------------------------------------------------------------------

test("standard CSL-JSON (doi.org) identifiers are strings, not lists", () => {
	const r = parseCsl({ type: "book", title: ["T"], ISSN: "1234-5678", ISBN: "978-0-14-312837-3 014312837X" } as any, "10.1/x", "doi.org")!;
	assert.equal(r.issn, "1234-5678");
	assert.equal(r.isbn, "9780143128373");
	const crossref = parseCsl({ type: "journal-article", title: ["T"], ISSN: ["0017-8012", "1234-5678"], ISBN: ["9780143128373"] }, "10.1/y", "Crossref")!;
	assert.equal(crossref.issn, "0017-8012");
	assert.equal(crossref.isbn, "9780143128373");
});

test("JSON-LD name parts and organizations survive lookup, note and export", async () => {
	const page = parseWebpage(
		`<script type="application/ld+json">{"@type":"Book","name":"Cien años","isbn":"9780060883287","datePublished":"1967","publisher":"P",
			"author":{"@type":"Person","givenName":"Gabriel","familyName":"García Márquez"},
			"editor":{"@type":"Person","givenName":"Ana","familyName":"de la Cruz Pérez"},
			"translator":{"@type":"Organization","name":"National Geographic"}}</script>`,
		"https://books.example/cien"
	);
	assert.deepEqual(page.authors, ["Gabriel García Márquez"]);
	const { item, fm } = await roundTrip(page);
	assert.deepEqual(fm.authors, ["[[Gabriel García Márquez|García Márquez, Gabriel]]"]);
	assert.deepEqual(fm.translators, ["[[National Geographic|{National Geographic}]]"]);
	assert.deepEqual(item.author, [{ family: "García Márquez", given: "Gabriel" }]);
	// The particle is split out, which CSL renders the same: "Ana de la Cruz Pérez".
	assert.deepEqual(item.editor, [{ family: "Cruz Pérez", given: "Ana", "non-dropping-particle": "de la" }]);
	assert.deepEqual(item.translator, [{ literal: "National Geographic" }]);
});
