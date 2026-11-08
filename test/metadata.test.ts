import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArxiv } from "../src/metadata/arxiv";
import { parseCsl } from "../src/metadata/crossref";
import { parseGoogleBooks } from "../src/metadata/googlebooks";
import { parseOpenLibrary } from "../src/metadata/openlibrary";
import { parseWebpage } from "../src/metadata/webpage";

test("Open Library", () => {
	const r = parseOpenLibrary(
		{
			"ISBN:9780143128373": {
				title: "The Brain's Way of Healing",
				subtitle: "Remarkable Discoveries and Recoveries from the Frontiers of Neuroplasticity",
				authors: [{ name: "Norman Doidge" }],
				publishers: [{ name: "Penguin Books" }],
				publish_date: "2016",
			},
		},
		"9780143128373"
	);
	assert.equal(r?.title, "The Brain's Way of Healing: Remarkable Discoveries and Recoveries from the Frontiers of Neuroplasticity");
	assert.deepEqual(r?.familyNames, ["Doidge"]);
	assert.equal(r?.year, 2016);
	assert.equal(r?.publisher, "Penguin Books");
});

test("Google Books", () => {
	const r = parseGoogleBooks(
		{ items: [{ volumeInfo: { title: "Think Again", authors: ["Adam Grant"], publishedDate: "2021-02-02", description: "<p>Hi</p>" } }] },
		"9781984878106"
	);
	assert.equal(r?.year, 2021);
	assert.equal(r?.abstract, "Hi");
});

test("Crossref / CSL", () => {
	const r = parseCsl(
		{
			type: "journal-article",
			title: ["Creating Shared Value"],
			author: [
				{ given: "Michael E.", family: "Porter" },
				{ given: "Mark R.", family: "Kramer" },
			],
			issued: { "date-parts": [[2011, 1]] },
			"container-title": ["Harvard Business Review"],
			abstract: "<jats:p>Capitalism is under siege.</jats:p>",
			DOI: "10.1000/hbr",
		},
		"10.1000/hbr",
		"Crossref"
	);
	assert.equal(r?.type, "article");
	assert.deepEqual(r?.authors, ["Michael E. Porter", "Mark R. Kramer"]);
	assert.deepEqual(r?.familyNames, ["Porter", "Kramer"]);
	assert.equal(r?.journal, "Harvard Business Review");
	assert.equal(r?.abstract, "Capitalism is under siege.");
});

test("arXiv Atom", () => {
	const xml = `<feed><entry><title>GPT-4 Technical
	Report</title><published>2023-03-15T17:15:04Z</published><summary>We report.</summary>
	<author><name>OpenAI</name></author></entry></feed>`;
	const r = parseArxiv(xml, "2303.08774");
	assert.equal(r?.title, "GPT-4 Technical Report");
	assert.equal(r?.year, 2023);
	assert.equal(r?.url, "https://arxiv.org/abs/2303.08774");
});

test("web page meta tags", () => {
	const html = `<html><head><title>Fallback</title>
	<meta property="og:title" content="On Silos">
	<meta name="author" content="Jane Amberg">
	<meta property="article:published_time" content="2025-03-01T10:00:00Z">
	<meta property="og:site_name" content="Example Blog">
	<meta name="description" content="Why silos form &amp; how to fix them.">
	</head></html>`;
	const r = parseWebpage(html, "https://example.com/silos");
	assert.equal(r.title, "On Silos");
	assert.deepEqual(r.familyNames, ["Amberg"]);
	assert.equal(r.year, 2025);
	assert.equal(r.journal, "Example Blog");
	assert.equal(r.abstract, "Why silos form & how to fix them.");
	assert.equal(r.type, "webpage");
});

test("Highwire tags make it an article and expose the DOI", () => {
	const html = `<meta name="citation_title" content="A Paper"><meta name="citation_author" content="Smith, Jane">
	<meta name="citation_journal_title" content="J. Things"><meta name="citation_doi" content="10.1234/abc">`;
	const r = parseWebpage(html, "https://journal.example/a");
	assert.equal(r.type, "article");
	assert.deepEqual(r.authors, ["Jane Smith"]);
	assert.equal(r.doi, "10.1234/abc");
});

test("og:url is only used when it is an absolute http(s) URL", () => {
	const evil = parseWebpage(`<meta property="og:url" content="javascript:alert(1)">`, "https://example.com/a");
	assert.equal(evil.url, "https://example.com/a");
	const ok = parseWebpage(`<meta property="og:url" content="https://example.com/canonical">`, "https://example.com/a?x=1");
	assert.equal(ok.url, "https://example.com/canonical");
});

test("numeric entities decode, and out-of-range ones don't throw", () => {
	const r = parseWebpage(`<meta name="description" content="it&#x27;s &#8212; ok &#99999999;">`, "https://example.com");
	assert.equal(r.abstract, "it's — ok &#99999999;");
});

test("data-name attributes are not mistaken for name", () => {
	const r = parseWebpage(`<meta data-name="author" name="description" content="D">`, "https://example.com");
	assert.equal(r.abstract, "D");
	assert.deepEqual(r.authors, []);
});

test("arXiv entities are decoded", () => {
	const r = parseArxiv(`<entry><title>Cats &amp; Dogs</title><author><name>A &amp; B</name></author></entry>`, "2301.00001");
	assert.equal(r?.title, "Cats & Dogs");
	assert.deepEqual(r?.authors, ["A & B"]);
});

test("Crossref URLs must be http(s)", () => {
	const r = parseCsl({ title: "T", URL: "javascript:alert(1)" }, "10.1/x", "Crossref");
	assert.equal(r?.url, undefined);
});
