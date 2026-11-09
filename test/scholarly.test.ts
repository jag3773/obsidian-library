// Scholarly capture (#23): PubMed, COinS, and what a Web Clipper note contributes.
import "./setup-dom";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectIdentifier, findIdentifierInText, pubmedIdFromUrl } from "../src/identifiers";
import { fillFromClip, fromClip } from "../src/inbox";
import { foundFromContextObject, parseContextObject } from "../src/metadata/coins";
import { Fetcher } from "../src/metadata/http";
import { lookup } from "../src/metadata/lookup";
import { parsePubmed, pubmedDate } from "../src/metadata/pubmed";
import { ReferenceData } from "../src/metadata/types";
import { parseWebpage } from "../src/metadata/webpage";
import { DEFAULT_PROPERTY_NAMES } from "../src/properties";

const fixture = (name: string) => readFileSync(`test/fixtures/web/${name}`, "utf8");

/** A fetcher that answers from a table of URL prefixes, and records what was asked. */
function fake(routes: [string, (url: string) => { status: number; text: string }][]): Fetcher & { calls: string[] } {
	const calls: string[] = [];
	const f = (async (url: string) => {
		calls.push(url);
		const r = routes.find(([prefix]) => url.startsWith(prefix));
		return r ? r[1](url) : { status: 404, text: "" };
	}) as Fetcher & { calls: string[] };
	f.calls = calls;
	return f;
}

// ---------------------------------------------------------------- PubMed IDs

test("PMIDs are detected with a prefix or as a PubMed URL, never as a bare number", () => {
	for (const s of ["PMID: 33301246", "pmid33301246", "PMID:33301246", "https://pubmed.ncbi.nlm.nih.gov/33301246/", "https://www.ncbi.nlm.nih.gov/pubmed/33301246"])
		assert.deepEqual(detectIdentifier(s), { kind: "pmid", value: "33301246" }, s);
	assert.equal(detectIdentifier("33301246"), null);
	assert.equal(pubmedIdFromUrl("https://pubmed.ncbi.nlm.nih.gov/33301246/?from=search"), "33301246");
	assert.equal(pubmedIdFromUrl("https://example.com/33301246"), undefined);
	// A PubMed search isn't a record.
	assert.equal(pubmedIdFromUrl("https://pubmed.ncbi.nlm.nih.gov/?term=covid"), undefined);
});

test("a PMID in PDF text is found after any DOI or ISBN", () => {
	assert.deepEqual(findIdentifierInText("Epub 2020 Dec 10. PMID: 33301246"), { kind: "pmid", value: "33301246" });
	assert.deepEqual(findIdentifierInText("PMID: 33301246 doi: 10.1056/NEJMoa2034577"), { kind: "doi", value: "10.1056/NEJMoa2034577" });
});

test("PubMed dates", () => {
	assert.equal(pubmedDate("2020 Dec 31"), "2020-12-31");
	assert.equal(pubmedDate("2020 Jan-Feb"), "2020-01");
	assert.equal(pubmedDate("2019 Spring"), "2019");
	assert.equal(pubmedDate("2019"), "2019");
	assert.equal(pubmedDate(""), undefined);
});

test("an E-utilities esummary record: title, authors, journal, date, DOI", () => {
	const r = parsePubmed(JSON.parse(fixture("pubmed-esummary.json")), "33301246")!;
	assert.equal(r.title, "Safety and Efficacy of the BNT162b2 mRNA Covid-19 Vaccine");
	assert.equal(r.type, "article");
	assert.equal(r.authors[0], "F. P. Polack");
	assert.deepEqual(r.familyNames.slice(0, 2), ["Polack", "Thomas"]);
	// The collective author stays whole.
	assert.equal(r.authors.at(-1), "C4591001 Clinical Trial Group");
	assert.deepEqual(r.names?.authors?.at(-1), { literal: "C4591001 Clinical Trial Group" });
	assert.equal(r.journal, "The New England journal of medicine");
	assert.equal(r.date, "2020-12-31");
	assert.equal(r.year, 2020);
	assert.equal(r.volume, "383");
	assert.equal(r.issue, "27");
	assert.equal(r.pages, "2603-2615");
	assert.equal(r.doi, "10.1056/NEJMoa2034577");
	assert.equal(r.url, "https://pubmed.ncbi.nlm.nih.gov/33301246/");
	assert.equal(r.source, "PubMed");
});

test("an unknown PMID gives nothing", () => {
	const json = { result: { uids: ["99999999999"], "99999999999": { uid: "99999999999", error: "cannot get document summary" } } };
	assert.equal(parsePubmed(json, "99999999999"), null);
	assert.equal(parsePubmed(null, "1"), null);
});

test("a PMID is looked up through E-utilities, then its DOI through Crossref, PubMed filling gaps", async () => {
	const fetch = fake([
		["https://eutils.ncbi.nlm.nih.gov/", () => ({ status: 200, text: fixture("pubmed-esummary.json") })],
		[
			"https://api.crossref.org/works/",
			() => ({
				status: 200,
				text: JSON.stringify({
					message: {
						type: "journal-article",
						title: ["Safety and Efficacy of the BNT162b2 mRNA Covid-19 Vaccine"],
						author: [{ given: "Fernando P.", family: "Polack" }],
						"container-title": ["New England Journal of Medicine"],
						issued: { "date-parts": [[2020, 12, 31]] },
						DOI: "10.1056/NEJMoa2034577",
						URL: "https://doi.org/10.1056/nejmoa2034577",
					},
				}),
			}),
		],
	]);
	const r = (await lookup(fetch, { kind: "pmid", value: "33301246" }))!;
	assert.ok(fetch.calls[0].includes("esummary.fcgi?db=pubmed&retmode=json&id=33301246"));
	assert.equal(r.authors[0], "Fernando P. Polack", "Crossref's full names lead");
	assert.equal(r.journal, "New England Journal of Medicine");
	assert.equal(r.pages, "2603-2615", "PubMed fills what Crossref lacks");
	assert.equal(r.pmid, "33301246");
	assert.equal(r.source, "Crossref and PubMed");
});

test("a PubMed URL goes to E-utilities, not the page (which may be a cookie check)", async () => {
	const fetch = fake([["https://eutils.ncbi.nlm.nih.gov/", () => ({ status: 200, text: fixture("pubmed-esummary.json").replace(/"doi"/g, '"none"') })]]);
	const r = (await lookup(fetch, { kind: "url", value: "https://pubmed.ncbi.nlm.nih.gov/33301246/" }))!;
	assert.equal(r.source, "PubMed");
	assert.equal(r.doi, undefined);
	assert.ok(!fetch.calls.some((u) => u.startsWith("https://pubmed.ncbi.nlm.nih.gov/")));
});

test("a page's citation_pmid is read and looked up when the page has no DOI", async () => {
	const page = `<title>Paper</title><meta name="citation_title" content="Paper"><meta name="citation_pmid" content="33301246">`;
	assert.equal(parseWebpage(page, "https://journal.example/a").pmid, "33301246");
	const fetch = fake([
		["https://journal.example/", () => ({ status: 200, text: page })],
		["https://eutils.ncbi.nlm.nih.gov/", () => ({ status: 200, text: fixture("pubmed-esummary.json").replace(/"doi"/g, '"none"') })],
	]);
	const r = (await lookup(fetch, { kind: "url", value: "https://journal.example/a" }))!;
	assert.equal(r.title, "Safety and Efficacy of the BNT162b2 mRNA Covid-19 Vaccine");
	assert.equal(r.url, "https://journal.example/a", "the page's own URL is kept");
});

// ---------------------------------------------------------------- COinS

test("a ContextObject is decoded into a work", () => {
	const co = parseContextObject(
		"ctx_ver=Z39.88-2004&rft_val_fmt=info%3Aofi%2Ffmt%3Akev%3Amtx%3Abook&rft.genre=bookitem&rft.atitle=A+Chapter&rft.btitle=The+Book&rft.aulast=Lovelace&rft.aufirst=Ada&rft.date=1843&rft.pub=Taylor&rft.place=London&rft.pages=1-20&rft.isbn=978-0-14-312837-3"
	);
	const f = foundFromContextObject(co);
	assert.equal(f.type, "chapter");
	assert.equal(f.title, "A Chapter");
	assert.equal(f.journal, "The Book");
	assert.deepEqual(f.authors, ["Ada Lovelace"]);
	assert.equal(f.date, "1843");
	assert.equal(f.publisher, "Taylor");
	assert.equal(f.place, "London");
	assert.equal(f.isbn, "9780143128373");
});

test("a page's one COinS span describing it supplies authors, journal and identifiers", () => {
	const r = parseWebpage(fixture("coins-article.html"), "https://repository.example.edu/item/42");
	assert.equal(r.title, "Rivers of Memory: Oral History in the Mekong Delta");
	assert.equal(r.type, "article");
	assert.deepEqual(r.authors, ["Thi Lan Nguyen", "Paul Okafor"]);
	assert.equal(r.journal, "Journal of Southeast Asian Studies");
	assert.equal(r.date, "2019-06");
	assert.equal(r.volume, "50");
	assert.equal(r.issue, "2");
	assert.equal(r.pages, "211-234");
	assert.equal(r.issn, "0022-4634");
	assert.equal(r.doi, "10.1017/S0022463419000123");
	assert.equal(r.abstract, "How villagers remember the floods.");
	assert.match(r.source, /COinS/);
});

test("COinS for works a page cites are not taken for the page", () => {
	const r = parseWebpage(fixture("coins-cited.html"), "https://encyclopedia.example/Mekong_Delta");
	assert.equal(r.title, "Mekong Delta - Encyclopedia");
	assert.deepEqual(r.authors, []);
	assert.equal(r.doi, undefined);
	assert.equal(r.isbn, undefined);
	// A single span about some other work is ignored too.
	const one = fixture("coins-cited.html").replace(/<li>Smith[\s\S]*?<\/li>/, "");
	assert.equal(parseWebpage(one, "https://encyclopedia.example/Mekong_Delta").doi, undefined);
});

test("COinS values can't inject a javascript: URL", () => {
	const html = `<title>T Title Here</title><span class="Z3988" title="rft.atitle=T+Title+Here&rft_id=javascript%3Aalert(1)&rft.identifier=javascript%3Aalert(1)"></span>`;
	const r = parseWebpage(html, "https://example.com/t");
	assert.equal(r.url, "https://example.com/t");
});

test("the source names the page layers that supplied metadata", () => {
	const r = parseWebpage(`<script type="application/ld+json">{"@type":"Article","headline":"H"}</script><meta name="author" content="Ana Lima">`, "https://example.com/h");
	assert.equal(r.source, "web page (schema.org, meta tags)");
});

// ---------------------------------------------------------------- Web Clipper notes

const props = { ...DEFAULT_PROPERTY_NAMES };

test("a Web Clipper note's title, author, published and description are read", () => {
	const clip = fromClip(
		{
			title: "On Silos",
			source: "https://blog.example/silos",
			author: ["[[Jane Amberg]]"],
			published: "2025-03-01",
			created: "2025-03-02",
			description: "Why silos form.",
			tags: ["clippings"],
		},
		props,
		"fallback"
	);
	assert.equal(clip.title, "On Silos");
	assert.deepEqual(clip.authors, ["Jane Amberg"]);
	assert.equal(clip.date, "2025-03-01");
	assert.equal(clip.year, 2025);
	assert.equal(clip.abstract, "Why silos form.");
});

test("the clip fills what a thinner lookup lacks, and the lookup's own values win", () => {
	const page: ReferenceData = { type: "webpage", title: "On Silos | Blog", authors: [], familyNames: [], abstract: "Why silos…", source: "web page" };
	const clip = fromClip({ title: "On Silos", author: "Jane Amberg", published: "March 1, 2025", description: "Why silos form, and how to fix them." }, props, "x");
	const r = fillFromClip(page, clip);
	assert.equal(r.title, "On Silos | Blog");
	assert.deepEqual(r.authors, ["Jane Amberg"]);
	assert.equal(r.date, "2025-03-01");
	assert.equal(r.abstract, "Why silos form, and how to fix them.", "a cut-short abstract gives way to the clip's full one");
	const full = fillFromClip({ ...page, abstract: "A complete abstract." }, clip);
	assert.equal(full.abstract, "A complete abstract.");
});
