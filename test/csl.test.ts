// #20: reference notes formatted with CSL styles through citeproc-js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CslItem, noteToCsl } from "../src/citation";
import { CslProcessor, bundledStyle, copyFormatted, incomplete, localeLang, splitLocator, styleInfo } from "../src/csl";
import { DEFAULT_PROPERTY_NAMES } from "../src/properties";
import numericStyle from "./fixtures/csl/numeric.csl";
import noteStyle from "./fixtures/csl/note.csl";

/** Notes as Stacks writes them (default property names), read back through the CSL-JSON mapping. */
const NOTES: Record<string, Record<string, unknown>> = {
	porter: {
		citekey: "porterCreatingSharedValue2011",
		type: "article",
		title: "Creating Shared Value",
		authors: ["[[Michael E. Porter]]", "[[Mark R. Kramer]]"],
		published: "2011-01",
		year: 2011,
		journal: "Harvard Business Review",
		volume: "89",
		issue: "1/2",
		pages: "62-77",
		doi: "10.1000/hbr",
	},
	book: {
		citekey: "hookerLawsEcclesiasticalPolity1989",
		type: "book",
		title: "Of the Laws of Ecclesiastical Polity",
		authors: ["[[Richard Hooker]]"],
		year: 1989,
		publisher: "Cambridge University Press",
		place: "Cambridge",
	},
	chapter: {
		citekey: "limaMethod2020",
		type: "chapter",
		title: "On Method",
		authors: ["Ana Lima"],
		editors: ["[[Gabriel García Márquez|García Márquez, Gabriel]]"],
		journal: "Collected Essays",
		publisher: "Example Press",
		place: "Chicago",
		year: 2020,
		pages: "10-25",
	},
	corporate: {
		citekey: "worldhealthorganizationWorldHealthStatistics2019",
		type: "report",
		title: "World Health Statistics",
		authors: ["[[World Health Organization]]"],
		publisher: "WHO",
		place: "Geneva",
		year: 2019,
	},
	undated: {
		citekey: "doeUndatedBook",
		type: "book",
		title: "Undated Book",
		authors: ["Jane Doe"],
		publisher: "Nowhere Press",
	},
};

const item = (name: string): CslItem => noteToCsl(NOTES[name], DEFAULT_PROPERTY_NAMES)!;
const all = () => Object.keys(NOTES).map(item);

let chicago: Promise<CslProcessor> | undefined;
const getChicago = async () => (chicago ??= CslProcessor.create({ style: await bundledStyle() }));

test("bundled style is Chicago author-date, in-text", async () => {
	const info = styleInfo(await bundledStyle());
	assert.match(info.title ?? "", /Chicago Manual of Style .*author-date/);
	assert.equal(info.class, "in-text");
	const p = await getChicago();
	assert.equal(p.isNote, false);
});

test("Chicago author-date bibliography: book, article, chapter, corporate author, missing date", async () => {
	const p = await getChicago();
	const bib = p.bibliography(all());
	assert.equal(
		bib.text,
		[
			"Doe, Jane. n.d. Undated Book. Nowhere Press.",
			"Hooker, Richard. 1989. Of the Laws of Ecclesiastical Polity. Cambridge University Press.",
			"Lima, Ana. 2020. “On Method.” In Collected Essays, edited by Gabriel García Márquez. Example Press.",
			"Porter, Michael E., and Mark R. Kramer. 2011. “Creating Shared Value.” Harvard Business Review 89 (1/2): 62–77. https://doi.org/10.1000/hbr.",
			"World Health Organization. 2019. World Health Statistics. WHO.",
		].join("\n")
	);
	// HTML keeps italics for titles of whole works and containers.
	assert.match(bib.html, /^<div class="csl-bib-body">/);
	assert.match(bib.html, /<i>Of the Laws of Ecclesiastical Polity<\/i>/);
	assert.match(bib.html, /In <i>Collected Essays<\/i>, edited by/);
	assert.match(bib.html, /“Creating Shared Value\.” <i>Harvard Business Review<\/i> 89/);
});

test("Chicago author-date citations, with locators and several references", async () => {
	const p = await getChicago();
	assert.deepEqual(p.citation([item("porter")]), { html: "(Porter and Kramer 2011)", text: "(Porter and Kramer 2011)" });
	assert.equal(p.citation([item("porter")], [{ id: item("porter").id, locator: "p. 64" }]).text, "(Porter and Kramer 2011, 64)");
	assert.equal(p.citation([item("undated")]).text, "(Doe, n.d.)");
	assert.equal(p.citation([item("corporate"), item("book")]).text, "(World Health Organization 2019; Hooker 1989)");
	assert.equal(
		p.citation([item("book")], [{ id: item("book").id, locator: "chap. 3", prefix: "see ", suppressAuthor: true }]).text,
		"(see 1989, chap. 3)"
	);
});

test("same author and year are told apart with a and b", async () => {
	const p = await getChicago();
	const a: CslItem = { id: "smithA", type: "book", title: "Alpha", author: [{ family: "Smith", given: "John" }], issued: { "date-parts": [[2001]] }, publisher: "P" };
	const b: CslItem = { ...a, id: "smithB", title: "Beta" };
	assert.equal(p.bibliography([a, b]).text, "Smith, John. 2001a. Alpha. P.\nSmith, John. 2001b. Beta. P.");
	assert.equal(p.citation([a, b]).text, "(Smith 2001a, 2001b)");
});

test("an edited note is read again, not served from the processor's cache", async () => {
	const p = await getChicago();
	const before = item("book");
	assert.match(p.bibliography([before]).text, /Polity/);
	const after = { ...before, title: "A Different Title" };
	assert.match(p.bibliography([after]).text, /A Different Title/);
	assert.doesNotMatch(p.bibliography([after]).text, /Polity/);
});

test("numeric style: numbers follow the order given", async () => {
	const p = await CslProcessor.create({ style: numericStyle });
	const bib = p.bibliography([item("porter"), item("book"), item("undated")]);
	assert.equal(
		bib.text,
		["[1] M. E. Porter and M. R. Kramer, Creating Shared Value, 2011.", "[2] R. Hooker, Of the Laws of Ecclesiastical Polity, 1989.", "[3] J. Doe, Undated Book."].join("\n")
	);
	assert.equal(p.citation([item("porter")], [{ id: item("porter").id, locator: "12" }]).text, "[1, p. 12]");
});

test("note style: the citation is the footnote text", async () => {
	const p = await CslProcessor.create({ style: noteStyle });
	assert.equal(p.isNote, true);
	const cite = p.citation([item("book")], [{ id: item("book").id, locator: "45" }]);
	assert.equal(cite.text, "Richard Hooker, Of the Laws of Ecclesiastical Polity, Cambridge University Press, 1989, 45.");
	assert.equal(cite.html, "Richard Hooker, <i>Of the Laws of Ecclesiastical Polity</i>, Cambridge University Press, 1989, 45.");
	assert.equal(p.bibliography([item("undated"), item("book")]).text, "Doe, Jane. Undated Book. Nowhere Press.\nHooker, Richard. Of the Laws of Ecclesiastical Polity. Cambridge University Press.");
});

test("a style without a <style> element is refused", async () => {
	await assert.rejects(CslProcessor.create({ style: "<locale/>" }), /isn't a CSL style/);
});

test("locator labels", () => {
	assert.deepEqual(splitLocator("12"), { label: "page", locator: "12" });
	assert.deepEqual(splitLocator("pp. 12-14"), { label: "page", locator: "12-14" });
	assert.deepEqual(splitLocator("chap. 3"), { label: "chapter", locator: "3" });
	assert.deepEqual(splitLocator("§ 4"), { label: "section", locator: "4" });
	assert.equal(splitLocator("  "), undefined);
});

test("locale files are recognised by their language", () => {
	assert.equal(localeLang('<?xml version="1.0"?><locale xmlns="http://purl.org/net/xbiblio/csl" version="1.0" xml:lang="de-DE">'), "de-DE");
	assert.equal(localeLang("<style/>"), undefined);
});

test("incomplete records are listed with what they lack", () => {
	assert.deepEqual(incomplete([item("undated"), item("book")]), ["doeUndatedBook: issued"]);
});

test("clipboard gets HTML and plain text, or text alone when HTML is refused", async () => {
	const f = { html: "<i>A</i>", text: "A" };
	const written: unknown[] = [];
	const rich = { write: async (items: unknown[]) => void written.push(...items), writeText: async (t: string) => void written.push(t) };
	const made: Record<string, Blob>[] = [];
	const result = await copyFormatted(rich as never, f, (d) => (made.push(d), d as never));
	assert.equal(result, "html");
	assert.deepEqual(Object.keys(made[0]).sort(), ["text/html", "text/plain"]);
	assert.equal(await made[0]["text/html"].text(), "<i>A</i>");
	assert.equal(await made[0]["text/plain"].text(), "A");

	const texts: string[] = [];
	const refusing = { write: async () => Promise.reject(new Error("no")), writeText: async (t: string) => void texts.push(t) };
	assert.equal(await copyFormatted(refusing, f, (d) => d as never), "text");
	assert.deepEqual(texts, ["A"]);
	assert.equal(await copyFormatted({ writeText: async (t: string) => void texts.push(t) }, f), "text");
});
