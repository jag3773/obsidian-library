// Find PDF (#24) and the clipped-note handoff (#23), against fixtures and the in-memory vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// "obsidian" is aliased to the mock by esbuild.test.mjs.
import { App, Notice, TFile, http } from "obsidian";
import { FullText } from "../src/fulltext";
import { Inbox } from "../src/inbox";
import { Library } from "../src/library";
import { PdfCandidate, describeCandidate, downloadPdf, findPdfCandidates, hasPdfMagic, notPdfReason, parseUnpaywall, pdfUrlFromPage } from "../src/metadata/fulltext";
import { Fetcher, HttpResponse } from "../src/metadata/http";
import { LibrarySettings, withDefaults } from "../src/settings";

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (name: string) => readFileSync(`test/fixtures/web/${name}`, "utf8");
const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const PDF = bytes("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");

async function flush(rounds = 20) {
	for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

type Route = (url: string, headers?: Record<string, string>) => HttpResponse | Promise<HttpResponse>;
function fake(routes: [string, Route][]): Fetcher & { calls: string[] } {
	const calls: string[] = [];
	const f = (async (url: string, headers?: Record<string, string>) => {
		calls.push(url);
		const r = routes.find(([prefix]) => url.startsWith(prefix));
		return r ? await r[1](url, headers) : { status: 404, text: "" };
	}) as Fetcher & { calls: string[] };
	f.calls = calls;
	return f;
}

const pdfResponse = (body = PDF, type = "application/pdf"): HttpResponse => ({ status: 200, text: "", headers: { "Content-Type": type }, body });

// ---------------------------------------------------------------- pure

test("Unpaywall: PDF locations, best first, without repeats or non-web links", () => {
	const c = parseUnpaywall(JSON.parse(fixture("unpaywall.json")));
	assert.deepEqual(
		c.map((x) => x.url),
		["https://europepmc.org/articles/pmc4221854?pdf=render", "https://dash.harvard.edu/bitstream/handle/1/12285462/Nanometer-Scale%20Thermometry.pdf"]
	);
	assert.equal(describeCandidate(c[0]), "Unpaywall: repository, accepted manuscript, cc-by (PubMed Central)");
	assert.match(describeCandidate(c[1]), /submitted manuscript/);
	assert.deepEqual(parseUnpaywall({ is_oa: false, best_oa_location: null, oa_locations: [] }), []);
	assert.deepEqual(parseUnpaywall("nonsense"), []);
});

test("a landing page's citation_pdf_url, absolute http(s) only", () => {
	assert.equal(pdfUrlFromPage(fixture("landing-page.html")), "https://journals.example.org/article/file?id=10.1371/journal.pone.0000308&type=printable");
	assert.equal(pdfUrlFromPage(`<meta name="citation_pdf_url" content="/doi/pdf/10.1/x">`), undefined);
	assert.equal(pdfUrlFromPage(`<title>none</title>`), undefined);
	assert.equal(describeCandidate({ url: "https://arxiv.org/pdf/2303.08774", source: "Landing page" }), "Landing page (arxiv.org)");
});

test("a download counts as a PDF only by content type and %PDF bytes", () => {
	assert.equal(hasPdfMagic(PDF), true);
	assert.equal(hasPdfMagic(bytes("\n\n%PDF-1.4")), true, "a little leading junk is allowed");
	assert.equal(hasPdfMagic(bytes("<html>")), false);
	assert.equal(hasPdfMagic(undefined), false);
	assert.equal(notPdfReason(pdfResponse()), undefined);
	assert.equal(notPdfReason(pdfResponse(PDF, "application/octet-stream")), undefined);
	assert.equal(notPdfReason({ status: 200, text: "", body: PDF }), undefined, "no content type, but PDF bytes");
	assert.match(notPdfReason(pdfResponse(bytes("<html>sign in</html>"), "text/html; charset=utf-8"))!, /text\/html/);
	assert.match(notPdfReason(pdfResponse(bytes("<html>"), "application/pdf"))!, /isn't a PDF/);
	assert.match(notPdfReason({ status: 403, text: "", body: PDF })!, /403/);
});

test("downloads follow redirects to the web only, and at most five", async () => {
	const ok = fake([
		["https://a.example/start", () => ({ status: 302, text: "", headers: { Location: "/next" } })],
		["https://a.example/next", () => pdfResponse()],
	]);
	const r = await downloadPdf(ok, "https://a.example/start");
	assert.ok("bytes" in r);
	assert.deepEqual(ok.calls, ["https://a.example/start", "https://a.example/next"]);
	const loop = fake([["https://a.example/", (u) => ({ status: 301, text: "", headers: { location: u } })]]);
	assert.deepEqual(await downloadPdf(loop, "https://a.example/x"), { error: "too many redirects" });
	const file = fake([["https://a.example/", () => ({ status: 302, text: "", headers: { location: "file:///etc/passwd" } })]]);
	assert.deepEqual(await downloadPdf(file, "https://a.example/x"), { error: "a redirect away from the web" });
	const thrown = (async () => {
		throw new Error("offline");
	}) as Fetcher;
	assert.deepEqual(await downloadPdf(thrown, "https://a.example/x"), { error: "offline" });
});

test("Unpaywall is asked only with a DOI and an email; the DOI's landing page is always tried", async () => {
	const routes: [string, Route][] = [
		["https://api.unpaywall.org/v2/", () => ({ status: 200, text: fixture("unpaywall.json") })],
		["https://doi.org/", () => ({ status: 200, text: fixture("landing-page.html") })],
	];
	const withEmail = fake(routes);
	const found = await findPdfCandidates(withEmail, { doi: "10.1038/nature12373" }, "me@example.org");
	assert.equal(withEmail.calls[0], "https://api.unpaywall.org/v2/10.1038%2Fnature12373?email=me%40example.org");
	assert.deepEqual(
		found.candidates.map((c) => c.source),
		["Unpaywall", "Unpaywall", "Landing page"]
	);
	const noEmail = fake(routes);
	const without = await findPdfCandidates(noEmail, { doi: "10.1038/nature12373" }, "");
	assert.ok(!noEmail.calls.some((u) => u.includes("unpaywall")));
	assert.deepEqual(
		without.candidates.map((c) => c.source),
		["Landing page"]
	);
	assert.match(without.notes.join(" "), /needs a contact email/);
	const nothing = await findPdfCandidates(fake([]), { url: "https://example.com/post" }, "me@example.org");
	assert.deepEqual(nothing.candidates, []);
	assert.match(nothing.notes.join(" "), /404/);
});

// ---------------------------------------------------------------- vault

function setup(overrides: Partial<LibrarySettings> = {}, routes: [string, Route][] = [], choice: (c: PdfCandidate[]) => PdfCandidate | null = (c) => c[0]) {
	const app = new App();
	const settings = withDefaults({ crossrefMailto: "me@example.org", ...overrides });
	const library = new Library(app as any, () => settings);
	const fetch = fake(routes);
	const asked: PdfCandidate[][] = [];
	const fullText = new FullText(app as any, library, fetch, () => settings, async (_note, search) => {
		asked.push(search.candidates);
		return choice(search.candidates);
	});
	Notice.messages = [];
	return { app, settings, library, fetch, fullText, asked };
}

const fm = (app: App, f: TFile) => app.metadataCache.getFileCache(f)?.frontmatter ?? {};

const openAccess: [string, Route][] = [
	["https://api.unpaywall.org/v2/", () => ({ status: 200, text: fixture("unpaywall.json") })],
	["https://doi.org/", () => ({ status: 404, text: "" })],
	["https://europepmc.org/", () => pdfResponse()],
];

test("Find PDF: confirms the source, saves under the attachment name, and links it", async () => {
	const { app, fullText, asked } = setup({}, openAccess);
	const note = app.vault.addFile("References/lovelace2020.md", `---\n{"citekey":"lovelace2020","title":"T","doi":"10.1038/nature12373"}\n---\nMy notes.\n`);
	const file = await fullText.find(note);
	await flush();
	assert.equal(asked.length, 1, "the person was asked before downloading");
	assert.equal(file?.path, "References/attachments/lovelace2020.pdf");
	assert.equal(fm(app, note).pdf, "[[lovelace2020.pdf]]");
	assert.deepEqual(fm(app, note).attachments, ["[[lovelace2020.pdf]]"]);
	assert.match(await app.vault.read(note), /My notes\.\n$/, "the body is untouched");
	assert.ok(Notice.messages.some((m) => /saved lovelace2020\.pdf from Unpaywall: repository, accepted manuscript/.test(m)));
});

test("Find PDF never replaces an existing file with the same name", async () => {
	const { app, fullText } = setup({}, openAccess);
	const other = app.vault.addFile("References/attachments/lovelace2020.pdf", "%PDF-1.4 someone else's");
	const note = app.vault.addFile("References/lovelace2020.md", `---\n{"citekey":"lovelace2020","doi":"10.1038/nature12373"}\n---\n`);
	const file = await fullText.find(note);
	assert.equal(file?.path, "References/attachments/lovelace2020 1.pdf");
	assert.equal(await app.vault.read(other), "%PDF-1.4 someone else's");
});

test("Find PDF refuses a note that already has a PDF, without any request", async () => {
	const { app, fullText, fetch } = setup({}, openAccess);
	const note = app.vault.addFile("References/n.md", `---\n{"citekey":"n","doi":"10.1038/nature12373","pdf":"[[mine.pdf]]"}\n---\n`);
	assert.equal(await fullText.find(note), null);
	assert.deepEqual(fetch.calls, []);
	assert.ok(Notice.messages.some((m) => m.includes("already has a PDF")));
});

test("Find PDF saves nothing when the person cancels, or the download is a sign-in page", async () => {
	const cancelled = setup({}, openAccess, () => null);
	const a = cancelled.app.vault.addFile("References/a.md", `---\n{"citekey":"a","doi":"10.1038/nature12373"}\n---\n`);
	assert.equal(await cancelled.fullText.find(a), null);
	assert.ok(!cancelled.fetch.calls.some((u) => u.startsWith("https://europepmc.org/")), "nothing downloaded");

	const html = setup({}, [...openAccess.slice(0, 2), ["https://europepmc.org/", () => pdfResponse(bytes("<html>Sign in</html>"), "text/html")]]);
	const b = html.app.vault.addFile("References/b.md", `---\n{"citekey":"b","doi":"10.1038/nature12373"}\n---\n`);
	assert.equal(await html.fullText.find(b), null);
	assert.equal(html.app.vault.getFiles().filter((f) => f.extension === "pdf").length, 0);
	assert.ok(html.app.vault.getAbstractFileByPath("References/attachments") === null);
	assert.ok(Notice.messages.some((m) => /text\/html, not a PDF\. Nothing was saved/.test(m)));
});

test("Find PDF explains the missing email and still tries the landing page", async () => {
	const { app, fullText, fetch } = setup({ crossrefMailto: "" }, [["https://doi.org/", () => ({ status: 200, text: "<title>x</title>" })]]);
	const note = app.vault.addFile("References/n.md", `---\n{"citekey":"n","doi":"10.1000/x"}\n---\n`);
	assert.equal(await fullText.find(note), null);
	assert.deepEqual(fetch.calls, ["https://doi.org/10.1000/x"]);
	assert.ok(Notice.messages.some((m) => /needs a contact email/.test(m) && /attach your own copy/.test(m)));
});

test("Find PDF does not save over a PDF linked while it downloaded", async () => {
	let note!: TFile;
	let app!: App;
	const env = setup({}, [
		...openAccess.slice(0, 2),
		[
			"https://europepmc.org/",
			async () => {
				// The person attaches their own copy meanwhile, and Obsidian indexes it.
				app.vault.write(note, `---\n{"citekey":"n","doi":"10.1038/nature12373","pdf":"[[own.pdf]]"}\n---\n`);
				await flush();
				return pdfResponse();
			},
		],
	]);
	app = env.app;
	note = app.vault.addFile("References/n.md", `---\n{"citekey":"n","doi":"10.1038/nature12373"}\n---\n`);
	const pending = env.fullText.find(note);
	assert.equal(await pending, null);
	assert.equal(app.vault.getFiles().filter((f) => f.extension === "pdf").length, 0);
});

// ---------------------------------------------------------------- the Web Clipper handoff

test("a clipped note keeps its body, and its clipped properties stand in when the lookup fails", async () => {
	const app = new App();
	const settings = withDefaults({});
	const library = new Library(app as any, () => settings);
	const inbox = new Inbox(app as any, library, async (url, headers) => (await import("obsidian")).requestUrl({ url, headers }), () => settings);
	http.handler = async () => ({ status: 503, text: "" });
	const body = "\n# On Silos\n\nThe clipped article, with [a link](https://blog.example/x) and ![img](https://blog.example/i.png).\n";
	const clip = app.vault.addFile(
		"Inbox/On Silos.md",
		`---\n${JSON.stringify({ title: "On Silos", source: "https://blog.example/silos", author: ["[[Jane Amberg]]"], published: "2025-03-01", created: "2025-03-02", description: "Why silos form.", tags: ["clippings"] })}\n---\n${body}`
	);
	assert.ok(await inbox.process(clip));
	await flush();
	const props = fm(app, clip);
	assert.ok(clip.path.startsWith("References/"));
	assert.equal(props.title, "On Silos");
	assert.deepEqual(props.authors, ["[[Jane Amberg]]"]);
	assert.equal(props.published, "2025-03-01");
	assert.equal(props.year, 2025);
	assert.equal(props.abstract, "Why silos form.");
	assert.equal(props.url, "https://blog.example/silos");
	assert.equal(props.status, settings.clipStatus);
	assert.ok((await app.vault.read(clip)).endsWith(body), "the clipped body is kept exactly");
});

test("a DOI the clipper saved finds the work when the site turns Stacks away", async () => {
	const app = new App();
	const settings = withDefaults({});
	const library = new Library(app as any, () => settings);
	const inbox = new Inbox(app as any, library, async (url, headers) => (await import("obsidian")).requestUrl({ url, headers }), () => settings);
	const work = { type: "journal-article", title: ["The Real Title"], author: [{ given: "Ada", family: "Lovelace" }], issued: { "date-parts": [[1843]] }, DOI: "10.1000/blocked" };
	http.handler = async ({ url }) =>
		url.startsWith("https://api.crossref.org/works/10.1000%2Fblocked") ? { status: 200, text: JSON.stringify({ message: work }) } : { status: 403, text: "<title>Just a moment...</title>" };
	const clip = app.vault.addFile("Inbox/c.md", `---\n${JSON.stringify({ source: "https://publisher.example/article/1", title: "Page title | Publisher", doi: "10.1000/blocked" })}\n---\nBody.\n`);
	assert.ok(await inbox.process(clip));
	await flush();
	const props = fm(app, clip);
	assert.equal(props.title, "The Real Title");
	assert.deepEqual(props.authors, ["[[Ada Lovelace]]"]);
	assert.equal(props.source, "https://publisher.example/article/1");
	assert.ok((await app.vault.read(clip)).endsWith("\nBody.\n"));
});
