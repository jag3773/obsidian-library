import "./setup-dom";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDate } from "../src/metadata/dates";
import { parseGitHubRepo } from "../src/metadata/github";
import { lookup } from "../src/metadata/lookup";
import { Fetcher } from "../src/metadata/http";
import { META_LIMITS, parseWebpage, readMeta } from "../src/metadata/webpage";
import { parseHtml } from "../src/metadata/html";

const fixture = (name: string) => readFileSync(`test/fixtures/web/${name}`, "utf8");

/** The four things every reference should come back with. */
function assertCore(
	r: { title: string; authors: string[]; date?: string; year?: number; abstract?: string },
	want: { title: string; authors: string[]; date: string; abstract: RegExp }
) {
	assert.equal(r.title, want.title);
	assert.deepEqual(r.authors, want.authors);
	assert.equal(r.date, want.date);
	assert.equal(r.year, Number(want.date.slice(0, 4)));
	assert.match(r.abstract ?? "", want.abstract);
}

test("Amazon book page: title, author, date, abstract and book details", () => {
	const r = parseWebpage(fixture("amazon-book.html"), "https://www.amazon.com/dp/0593135202");
	assertCore(r, {
		title: "Project Hail Mary: A Novel",
		authors: ["Andy Weir"],
		date: "2021-05-04",
		abstract: /^#1 NEW YORK TIMES BESTSELLER .*A lone astronaut must save the earth/s,
	});
	assert.equal(r.type, "book");
	assert.equal(r.isbn, "9780593135204");
	assert.equal(r.publisher, "Ballantine Books");
	assert.deepEqual(r.familyNames, ["Weir"]);
});

test("Goodreads book page: full description and publication date from the page data", () => {
	const r = parseWebpage(fixture("goodreads-book.html"), "https://www.goodreads.com/book/show/54493401-project-hail-mary");
	assertCore(r, {
		title: "Project Hail Mary",
		authors: ["Andy Weir"],
		date: "2021-05-04",
		abstract: /^Ryland Grace is the sole survivor.*\n\nOr does he\?$/s,
	});
	assert.equal(r.type, "book");
	assert.equal(r.isbn, "9780593135204");
	assert.equal(r.publisher, "Ballantine Books");
	assert.equal(r.url, "https://www.goodreads.com/book/show/54493401-project-hail-mary");
});

test("Kobo book page: JSON-LD book with its edition, and the synopsis", () => {
	const r = parseWebpage(fixture("kobo-book.html"), "https://www.kobo.com/us/en/ebook/project-hail-mary");
	assertCore(r, {
		title: "Project Hail Mary",
		authors: ["Andy Weir"],
		date: "2021-05-04",
		abstract: /^THE SUNDAY TIMES BESTSELLING NOVEL\n\n.*A lone astronaut\./s,
	});
	assert.equal(r.type, "book");
	assert.equal(r.isbn, "9781473582583");
	assert.equal(r.publisher, "Random House");
	assert.doesNotMatch(r.abstract ?? "", /Rakuten Kobo/);
});

test("Kobo's JSON-LD description loses its store blurb when there is no synopsis", () => {
	const html = fixture("kobo-book.html").replace(/<div class="synopsis-description"[\s\S]*?<\/div>/, "");
	const r = parseWebpage(html, "https://www.kobo.com/us/en/ebook/project-hail-mary");
	assert.match(r.abstract ?? "", /^THE SUNDAY TIMES BESTSELLING NOVEL/);
});

test("GitHub repository from the API: name, owner's name, creation date, description", () => {
	const r = parseGitHubRepo(JSON.parse(fixture("github-repo.json")), JSON.parse(fixture("github-user.json")));
	assertCore(r!, {
		title: "obsidian-library",
		authors: ["Jesse Griffin"],
		date: "2026-11-08",
		abstract: /^A full featured library plugin for Obsidian$/,
	});
	assert.equal(r?.type, "software");
	assert.equal(r?.journal, "GitHub");
	assert.equal(r?.url, "https://github.com/jag3773/obsidian-library");
});

test("GitHub repository page without the API still splits GitHub's title", () => {
	const r = parseWebpage(fixture("github-repo.html"), "https://github.com/jag3773/obsidian-library");
	assert.equal(r.title, "obsidian-library");
	assert.deepEqual(r.authors, ["jag3773"]);
	assert.equal(r.abstract, "A full featured library plugin for Obsidian");
	assert.equal(r.type, "software");
});

/** A fetcher that serves fixtures by URL prefix and records what was asked for. */
function serve(routes: Record<string, { status?: number; text: string }>): Fetcher & { calls: string[] } {
	const calls: string[] = [];
	const f = async (url: string) => {
		calls.push(url);
		const hit = Object.keys(routes).find((p) => url.startsWith(p));
		return hit ? { status: routes[hit].status ?? 200, text: routes[hit].text } : { status: 404, text: "" };
	};
	return Object.assign(f, { calls });
}

test("a GitHub URL goes through the API, then the owner's profile", async () => {
	const fetch = serve({
		"https://api.github.com/repos/jag3773/obsidian-library": { text: fixture("github-repo.json") },
		"https://api.github.com/users/jag3773": { text: fixture("github-user.json") },
	});
	const r = await lookup(fetch, { kind: "url", value: "https://github.com/jag3773/obsidian-library" });
	assert.equal(r?.title, "obsidian-library");
	assert.deepEqual(r?.authors, ["Jesse Griffin"]);
	assert.equal(r?.date, "2026-11-08");
	assert.equal(fetch.calls.some((u) => u.startsWith("https://github.com/")), false, "page not needed");
});

test("when the GitHub API is rate limited the page is used", async () => {
	const fetch = serve({
		"https://api.github.com/": { status: 403, text: '{"message":"API rate limit exceeded"}' },
		"https://github.com/jag3773/obsidian-library": { text: fixture("github-repo.html") },
	});
	const r = await lookup(fetch, { kind: "url", value: "https://github.com/jag3773/obsidian-library" });
	assert.equal(r?.title, "obsidian-library");
	assert.equal(r?.abstract, "A full featured library plugin for Obsidian");
});

test("GitHub pages that aren't a repository root aren't treated as repositories", async () => {
	const fetch = serve({ "https://github.com/": { text: "<title>Topics</title>" } });
	const r = await lookup(fetch, { kind: "url", value: "https://github.com/topics/obsidian" });
	assert.equal(r?.title, "Topics");
	assert.equal(fetch.calls.some((u) => u.includes("api.github.com")), false);
});

test("a book page missing a date or abstract borrows them by ISBN, without replacing what it has", async () => {
	const html = `<title>T</title><script type="application/ld+json">{"@type":"Book","name":"Page Title","author":{"name":"Page Author"},"isbn":"9780593135204","description":"From the page."}</script>`;
	const fetch = serve({
		"https://books.example/b": { text: html },
		"https://openlibrary.org/": {
			text: JSON.stringify({ "ISBN:9780593135204": { title: "OL Title", authors: [{ name: "OL Author" }], publish_date: "May 04, 2021", publishers: [{ name: "Ballantine" }] } }),
		},
		"https://www.googleapis.com/": { text: JSON.stringify({ items: [{ volumeInfo: { title: "G", description: "<p>From Google.</p>" } }] }) },
	});
	const r = await lookup(fetch, { kind: "url", value: "https://books.example/b" });
	assert.equal(r?.title, "Page Title");
	assert.deepEqual(r?.authors, ["Page Author"]);
	assert.equal(r?.date, "2021-05-04");
	assert.equal(r?.publisher, "Ballantine");
	assert.equal(r?.abstract, "From the page.", "the page's own description is kept");
	assert.equal(r?.url, "https://books.example/b");
});

test("JSON-LD articles in a @graph, with several authors", () => {
	const html = `<title>Site | x</title><script type="application/ld+json">{"@context":"https://schema.org","@graph":[
		{"@type":"WebSite","name":"Example"},
		{"@type":["NewsArticle"],"headline":"Rivers &amp; Roads","datePublished":"2024-02-29T08:00:00-05:00",
		 "author":[{"@type":"Person","name":"Ana Lima"},{"@type":"Person","name":"Bo Chen"}],
		 "publisher":{"@type":"Organization","name":"Example News"},"description":"A story."}]}</script>`;
	const r = parseWebpage(html, "https://news.example/a");
	assert.equal(r.title, "Rivers & Roads");
	assert.deepEqual(r.authors, ["Ana Lima", "Bo Chen"]);
	assert.equal(r.date, "2024-02-29");
	assert.equal(r.publisher, "Example News");
	assert.equal(r.abstract, "A story.");
});

test("broken or hostile JSON-LD is ignored", () => {
	const html = `<script type="application/ld+json">{nope</script><script type="application/ld+json">{"@type":"Article","name":{"x":1},"author":42,"datePublished":["x"]}</script><meta property="og:title" content="Fallback">`;
	const r = parseWebpage(html, "https://example.com/");
	assert.equal(r.title, "Fallback");
	assert.deepEqual(r.authors, []);
	assert.equal(r.date, undefined);
});

test("a truncated meta description gives way to a full one", () => {
	const html = `<meta name="citation_abstract" content="Short and cut off no longer, this is the whole thing."><script type="application/ld+json">{"@type":"Article","headline":"H","description":"Short and cut…"}</script>`;
	assert.equal(parseWebpage(html, "https://example.com/").abstract, "Short and cut off no longer, this is the whole thing.");
});

test("dates in the formats pages use", () => {
	assert.equal(parseDate("2021-05-04T00:00:00Z"), "2021-05-04");
	assert.equal(parseDate("2020/05/01"), "2020-05-01");
	assert.equal(parseDate("May 4, 2021"), "2021-05-04");
	assert.equal(parseDate("May 04, 2021"), "2021-05-04");
	assert.equal(parseDate("4 May 2021"), "2021-05-04");
	assert.equal(parseDate("Sept. 3, 2020"), "2020-09-03");
	assert.equal(parseDate("First published May 4, 2021"), "2021-05-04");
	assert.equal(parseDate("March 2019"), "2019-03");
	assert.equal(parseDate("2019-03"), "2019-03");
	assert.equal(parseDate("c. 1999"), "1999");
	assert.equal(parseDate(1620111600000), "2021-05-04");
	assert.equal(parseDate("2021-13-40"), "2021");
	assert.equal(parseDate("Feb 30, 2021"), "2021-02");
	assert.equal(parseDate("nothing"), undefined);
	assert.equal(parseDate(undefined), undefined);
});

test("a product barcode isn't taken for an ISBN", () => {
	const html = `<script type="application/ld+json">{"@type":"CreativeWork","name":"Pens","gtin13":"4006381333931"}</script>`;
	const r = parseWebpage(html, "https://shop.example/pens");
	assert.equal(r.isbn, undefined);
	assert.equal(r.type, "webpage");
});

test("a Book's edition (workExample) supplies its ISBN and date", () => {
	const html = `<script type="application/ld+json">{"@type":"Book","name":"W","author":"A Writer","workExample":[{"@type":"Book","isbn":"978-0-593-13520-4","datePublished":"2021-05-04"}]}</script>`;
	const r = parseWebpage(html, "https://books.example/w");
	assert.equal(r.isbn, "9780593135204");
	assert.equal(r.date, "2021-05-04");
	assert.deepEqual(r.authors, ["A Writer"]);
});

test("Amazon keeps authors and leaves out translators and narrators", () => {
	const person = (name: string, role: string) =>
		`<span class="author"><a class="a-link-normal" href="#">${name}</a><span class="contribution"><span>(${role})</span></span></span>`;
	const html = `<span id="productTitle">Ficciones</span><div id="bylineInfo">${person("Jorge Luis Borges", "Author")}${person("Andrew Hurley", "Translator")}${person("Ana Reader", "Narrator")}</div>`;
	const r = parseWebpage(html, "https://www.amazon.com/dp/x");
	assert.deepEqual(r.authors, ["Jorge Luis Borges"]);
	const edited = parseWebpage(html.replace("(Author)", "(Editor)"), "https://www.amazon.com/dp/x");
	assert.deepEqual(edited.authors, ["Jorge Luis Borges", "Andrew Hurley", "Ana Reader"], "with no author, every contributor is listed");
});

test("Goodreads' date comes from its page data when the visible line is missing", () => {
	const html = fixture("goodreads-book.html").replace(/<[^>]+data-testid="publicationInfo"[^>]*>[^<]*<\/[^>]+>/, "");
	assert.doesNotMatch(html, /publicationInfo/);
	assert.equal(parseWebpage(html, "https://www.goodreads.com/book/show/54493401").date, "2021-05-04");
});

// Patterns seen on news sites in a real library (New Atlas, Christianity Today, Mission
// Network News, YouTube, Cloudflare's blog, HBR, Christian Today).

test("an author given as a reference to a Person elsewhere in the graph is resolved", () => {
	const html = `<script type="application/ld+json">{"@graph":[
		{"@type":"NewsArticle","headline":"Chip","datePublished":"2023-07-21","author":{"@id":"https://n.example/author/loz/#author"}},
		{"@type":"Person","@id":"https://n.example/author/loz/#author","name":"Loz Blain"}]}</script>`;
	assert.deepEqual(parseWebpage(html, "https://n.example/a").authors, ["Loz Blain"]);
});

test("a block naming its authors beats an SEO plugin's block pointing at the poster's account", () => {
	const html = `<script type="application/ld+json">{"@graph":[
		{"@type":"Article","headline":"Iranians Gain 12 New Ways","author":{"name":"CMS Admin","@id":"#/schema/person/1"},"datePublished":"2024-01-24"},
		{"@type":"Person","@id":"#/schema/person/1","name":"CMS Admin"}]}</script>
		<script type="application/ld+json">{"@type":"NewsArticle","headline":"Iranians Gain 12 New Ways","author":[{"@type":"Person","name":"Jayson Casper"}],"datePublished":"2024-01-24"}</script>`;
	assert.deepEqual(parseWebpage(html, "https://ct.example/a").authors, ["Jayson Casper"]);
});

test("a page described only as a WebPage still gives its date, and rel=author gives the byline", () => {
	const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage","name":"Occult king meets the King of Kings","datePublished":"2023-05-25T04:00:27+00:00"},{"@type":"WebSite","name":"MNN"}]}</script>
		<div class="meta"><span class="meta-author vcard author"><a href="/author/katey" rel="author">Katey Hearth</a></span></div><article><p>Text</p></article>`;
	const r = parseWebpage(html, "https://mnn.example/a");
	assert.equal(r.date, "2023-05-25");
	assert.deepEqual(r.authors, ["Katey Hearth"]);
});

test("YouTube's channel comes from microdata", () => {
	const html = `<meta itemprop="datePublished" content="2013-02-25"><span itemprop="author" itemscope itemtype="http://schema.org/Person"><link itemprop="url" href="http://www.youtube.com/@TED"><link itemprop="name" content="TED"></span>`;
	const r = parseWebpage(html, "https://www.youtube.com/watch?v=x");
	assert.deepEqual(r.authors, ["TED"]);
	assert.equal(r.date, "2013-02-25");
	assert.equal(r.type, "video");
});

test("author-page links and byline links are read inside the article, and only if they look like names", () => {
	const cloudflare = `<article><a href="/author/joao-tome/">João Tomé</a></article><aside><a href="/author/someone-else/">Someone Else</a></aside>`;
	assert.deepEqual(parseWebpage(cloudflare, "https://blog.example/p").authors, ["João Tomé"]);
	const hbr = `<p class="byline"><span class="x_byline">by <a href="/search?term=John J. Morse">John J. Morse</a> and <a href="/search?term=Jay W. Lorsch">Jay W. Lorsch</a> <a href="/follow">follow this topic</a></span></p>`;
	assert.deepEqual(parseWebpage(hbr, "https://hbr.example/p").authors, ["John J. Morse", "Jay W. Lorsch"]);
});

test("an article's <time datetime> is the date of last resort", () => {
	const html = `<meta name="author" content="Eric Steggerda"><article><time datetime="2023-05-29T05:40">29 May, 2023 05:40 BST</time></article><footer><time datetime="2020-01-01">old</time></footer>`;
	assert.equal(parseWebpage(html, "https://ctoday.example/a").date, "2023-05-29");
	const tagged = `<meta property="article:published_time" content="2021-01-02">` + html;
	assert.equal(parseWebpage(tagged, "https://ctoday.example/a").date, "2021-01-02", "tags win");
});

test("news stories and blog posts are typed article; other pages stay webpage", () => {
	const ld = (type: string) => `<script type="application/ld+json">{"@type":"${type}","headline":"H"}</script>`;
	for (const t of ["NewsArticle", "BlogPosting", "Article", "ReportageNewsArticle"]) assert.equal(parseWebpage(ld(t), "https://n.example/a").type, "article", t);
	assert.equal(parseWebpage(`<meta property="og:type" content="article"><title>T</title>`, "https://n.example/a").type, "article");
	assert.equal(parseWebpage(`<meta property="og:type" content="website"><title>T</title>`, "https://n.example/").type, "webpage");
	assert.equal(parseWebpage(ld("WebPage"), "https://n.example/p").type, "webpage");
});

test("a page that is only a schema.org WebPage takes its type from og:type", () => {
	const html = `<meta property="og:type" content="article"><script type="application/ld+json">{"@type":"WebPage","name":"Occult king","datePublished":"2023-05-25"}</script>`;
	const r = parseWebpage(html, "https://mnn.example/a");
	assert.equal(r.type, "article");
	assert.equal(r.date, "2023-05-25");
});

// PR #34 review --------------------------------------------------------------------------

test("a page flooded with meta tags is read in bounded time and memory", () => {
	const html = `<html><head><meta property="og:title" content="Real">${'<meta name="author" content="A">'.repeat(120_000)}</head></html>`;
	const doc = parseHtml(html);
	const started = Date.now();
	const meta = readMeta(doc);
	const elapsed = Date.now() - started;
	assert.equal(meta.get("author")?.length, META_LIMITS.perKey);
	assert.ok(elapsed < 500, `readMeta took ${elapsed} ms`);
	assert.equal(parseWebpage(html, "https://x.example/").title, "Real");
});

test("Yoast-style linked graph: author, publisher and site resolved by @id", () => {
	const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
		{"@type":"Article","@id":"#article","headline":"Linked","author":{"@id":"#author"},"publisher":{"@id":"#publisher"},"isPartOf":{"@id":"#website"},"datePublished":"2022-02-02"},
		{"@type":"Person","@id":"#author","name":"Ana Lima","author":{"@id":"#author"}},
		{"@type":"Organization","@id":"#publisher","name":"Example Media"},
		{"@type":"WebSite","@id":"#website","name":"Example Site","isPartOf":{"@id":"#article"}}]}</script>`;
	const r = parseWebpage(html, "https://y.example/a");
	assert.deepEqual(r.authors, ["Ana Lima"]);
	assert.equal(r.publisher, "Example Media");
	assert.equal(r.journal, "Example Site");
});

test("an Amazon byline with only a translator doesn't beat the page's real author", () => {
	const byline = `<span id="productTitle">Ficciones</span><div id="bylineInfo"><span class="author"><a class="a-link-normal" href="#">Ana Translator</a><span class="contribution">(Translator)</span></span></div>`;
	const withLd = byline + `<script type="application/ld+json">{"@type":"Book","name":"Ficciones","author":{"name":"Real Author"}}</script>`;
	assert.deepEqual(parseWebpage(withLd, "https://www.amazon.com/dp/x").authors, ["Real Author"]);
	const alone = parseWebpage(byline, "https://www.amazon.com/dp/x");
	assert.deepEqual(alone.authors, ["Ana Translator"], "with nothing else, the contributor stands in");
	assert.equal(alone.contributorsOnly, true);
});

test("a translator-only Amazon page takes the author from the ISBN's record", async () => {
	const html = `<span id="productTitle">Ficciones</span><div id="bylineInfo"><span class="author"><a class="a-link-normal" href="#">Ana Translator</a><span class="contribution">(Translator)</span></span></div>
		<div id="rpi-attribute-book_details-isbn13"><div class="rpi-attribute-value"><span>978-0593135204</span></div></div>`;
	const fetch = serve({
		"https://www.amazon.com/dp/x": { text: html },
		"https://openlibrary.org/": { text: JSON.stringify({ "ISBN:9780593135204": { title: "F", authors: [{ name: "Jorge Luis Borges" }], publish_date: "1962" } }) },
	});
	const r = await lookup(fetch, { kind: "url", value: "https://www.amazon.com/dp/x" });
	assert.deepEqual(r?.authors, ["Jorge Luis Borges"]);
	assert.deepEqual(r?.familyNames, ["Borges"]);
	assert.equal(r?.contributorsOnly, undefined);
});

test("a sparse Open Library record is completed from Google Books, keeping the page's values", async () => {
	const html = `<script type="application/ld+json">{"@type":"Book","name":"Page Title","isbn":"9780593135204"}</script>`;
	const fetch = serve({
		"https://books.example/b": { text: html },
		"https://openlibrary.org/": { text: JSON.stringify({ "ISBN:9780593135204": { title: "OL title" } }) },
		"https://www.googleapis.com/": {
			text: JSON.stringify({ items: [{ volumeInfo: { title: "G", authors: ["Andy Weir"], publishedDate: "2021-05-04", publisher: "Ballantine", description: "Desc." } }] }),
		},
	});
	const r = await lookup(fetch, { kind: "url", value: "https://books.example/b" });
	assert.equal(r?.title, "Page Title");
	assert.deepEqual(r?.authors, ["Andy Weir"]);
	assert.equal(r?.date, "2021-05-04");
	assert.equal(r?.publisher, "Ballantine");
	assert.equal(r?.abstract, "Desc.");
});
