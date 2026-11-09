import { test } from "node:test";
import assert from "node:assert/strict";
import { HealthNote, checkHealth, dateMs, healthReportMarkdown, pathLink, problemCount } from "../src/health";
import { DEFAULT_PROPERTY_NAMES } from "../src/properties";

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 9).getTime();
const options = { properties: DEFAULT_PROPERTY_NAMES, staleDays: 365, staleStatuses: ["reading"], now: NOW };

function note(path: string, frontmatter: Record<string, unknown> | null, extra: Partial<HealthNote> = {}): HealthNote {
	const basename = path.replace(/^.*\//, "").replace(/\.md$/, "");
	const key = frontmatter?.citekey as string | undefined;
	return { path, basename, frontmatter, expectedBasename: key, pdfNames: key ? [`${key}.pdf`] : [], linked: [], modified: NOW, ...extra };
}

const book = (key: string, extra: Record<string, unknown> = {}) => ({ citekey: key, type: "book", title: "T", authors: ["A B"], year: 2020, publisher: "P", ...extra });

test("a clean library has no problems", () => {
	const r = checkHealth({ notes: [note("R/a.md", book("a"))], pdfs: [], duplicates: [] }, options);
	assert.equal(problemCount(r), 0);
	assert.match(healthReportMarkdown(r, ctx), /Nothing to fix\./);
});

test("citekey checks: missing, duplicated (any case), not matching the filename", () => {
	const r = checkHealth(
		{
			notes: [note("R/a.md", book("a")), note("R/A 1.md", book("A")), note("R/none.md", { title: "x" }), note("R/old.md", book("new"))],
			pdfs: [],
			duplicates: [],
		},
		options
	);
	assert.deepEqual(r.missingCitekey, ["R/none.md"]);
	assert.deepEqual(r.duplicateCitekeys, [{ citekey: "A", paths: ["R/A 1.md", "R/a.md"] }]);
	assert.deepEqual(
		r.filenameMismatch.map((m) => [m.path, m.expected]),
		[
			["R/A 1.md", "A"],
			["R/old.md", "new"],
		]
	);
});

test("broken frontmatter is reported and its note skips the other checks", () => {
	const r = checkHealth({ notes: [note("R/bad.md", null, { parseError: "bad indentation\nat line 2" })], pdfs: [], duplicates: [] }, options);
	assert.deepEqual(r.brokenFrontmatter, [{ path: "R/bad.md", error: "bad indentation\nat line 2" }]);
	assert.deepEqual(r.missingCitekey, []);
	assert.match(healthReportMarkdown(r, ctx), /- \[\[R\/bad\|bad\]\]: bad indentation\n/);
});

test("an unresolved pdf with a PDF named after the citekey is offered as a repair", () => {
	const r = checkHealth(
		{
			notes: [
				note("R/a.md", book("a", { pdf: "[[old.pdf]]" }), { pdf: { value: "[[old.pdf]]", resolves: false } }),
				note("R/b.md", book("b", { pdf: "[[gone.pdf]]" }), { pdf: { value: "[[gone.pdf]]", resolves: false } }),
			],
			pdfs: [
				{ path: "Elsewhere/a.pdf", inAttachments: false },
				{ path: "R/attachments/a.pdf", inAttachments: true },
			],
			duplicates: [],
		},
		options
	);
	assert.deepEqual(r.unresolvedPdf, [
		{ path: "R/a.md", value: "[[old.pdf]]", candidate: "R/attachments/a.pdf" },
		{ path: "R/b.md", value: "[[gone.pdf]]", candidate: undefined },
	]);
	assert.deepEqual(r.repairs, [{ note: "R/a.md", pdf: "R/attachments/a.pdf", previous: "[[old.pdf]]" }]);
	// The PDF it will be linked to isn't offered twice as an orphan.
	assert.deepEqual(r.orphanPdfs, [{ path: "R/attachments/a.pdf", candidateNote: undefined }]);
});

test("orphan PDFs: unlinked ones in the attachments folder, linked to a note without a pdf when named after it", () => {
	const r = checkHealth(
		{
			notes: [note("R/a.md", book("a")), note("R/b.md", book("b", { pdf: "[[b.pdf]]" }), { pdf: { value: "[[b.pdf]]", resolves: true }, linked: ["R/att/b.pdf"] })],
			pdfs: [
				{ path: "R/att/a.pdf", inAttachments: true },
				{ path: "R/att/b.pdf", inAttachments: true },
				{ path: "R/att/stray.pdf", inAttachments: true },
				{ path: "Other/x.pdf", inAttachments: false },
			],
			duplicates: [],
		},
		options
	);
	assert.deepEqual(r.orphanPdfs, [
		{ path: "R/att/a.pdf", candidateNote: "R/a.md" },
		{ path: "R/att/stray.pdf", candidateNote: undefined },
	]);
	assert.deepEqual(r.repairs, [{ note: "R/a.md", pdf: "R/att/a.pdf" }]);
});

test("stale items: watched statuses only, from the later of last change and date added", () => {
	const old = NOW - 400 * DAY;
	const r = checkHealth(
		{
			notes: [
				note("R/a.md", book("a", { status: "reading" }), { modified: old }),
				note("R/b.md", book("b", { status: "processed" }), { modified: old }),
				note("R/c.md", book("c", { status: "reading", added: "2026-10-01" }), { modified: old }),
				note("R/d.md", book("d", { status: "reading" }), { modified: NOW - 10 * DAY }),
			],
			pdfs: [],
			duplicates: [],
		},
		options
	);
	assert.deepEqual(r.stale, [{ path: "R/a.md", status: "reading", days: 400 }]);
	assert.deepEqual(checkHealth({ notes: [note("R/a.md", book("a", { status: "reading" }), { modified: old })], pdfs: [], duplicates: [] }, { ...options, staleDays: 0 }).stale, []);
	assert.equal(checkHealth({ notes: [note("R/b.md", book("b", { status: "processed" }), { modified: old })], pdfs: [], duplicates: [] }, { ...options, staleStatuses: [] }).stale.length, 1);
});

test("type checks: missing, unknown, and fields the type needs", () => {
	const r = checkHealth(
		{
			notes: [
				note("R/a.md", { citekey: "a", title: "T" }),
				note("R/b.md", { citekey: "b", title: "T", type: "podcast" }),
				note("R/c.md", { citekey: "c", title: "T", type: "book", authors: ["A B"] }),
			],
			pdfs: [],
			duplicates: [],
		},
		options
	);
	assert.deepEqual(r.missingType, ["R/a.md"]);
	assert.deepEqual(r.unknownType, [{ path: "R/b.md", type: "podcast" }]);
	assert.deepEqual(r.missingFields, [{ path: "R/c.md", type: "book", fields: ["published or year", "publisher"] }]);
});

test("dateMs reads YYYY-MM-DD, with or without a time", () => {
	assert.equal(dateMs("2026-11-09"), NOW);
	assert.equal(dateMs("2026-11-09 1405"), NOW);
	assert.equal(dateMs("soon"), undefined);
});

test("pathLink links by full path and shows the name", () => {
	assert.equal(pathLink("References/smith2020.md"), "[[References/smith2020|smith2020]]");
	assert.equal(pathLink("top.md"), "[[top]]");
	assert.equal(pathLink("R/att/a.pdf"), "[[R/att/a.pdf|a.pdf]]");
});

const ctx = {
	date: "2026-11-09 1405",
	staleDays: 365,
	commands: { check: "Stacks: Check library health", relink: "Stacks: Relink PDFs", review: "Stacks: Review duplicates", mergeCurrent: "Stacks: Merge current" },
	properties: DEFAULT_PROPERTY_NAMES,
};

test("the report lists each problem with a link and names the commands that fix them", () => {
	const r = checkHealth(
		{
			notes: [note("R/a.md", book("a", { pdf: "[[x.pdf]]" }), { pdf: { value: "[[x.pdf]]", resolves: false } }), note("R/b.md", book("b"))],
			pdfs: [{ path: "R/att/a.pdf", inAttachments: true }],
			duplicates: [{ paths: ["R/a.md", "R/b.md"], pairs: [{ a: "R/a.md", b: "R/b.md", reasons: [{ kind: "doi", value: "10.1000/x" }] }] }],
		},
		options
	);
	const md = healthReportMarkdown(r, ctx);
	assert.match(md, /^# Library health check\n/);
	assert.match(md, /\| pdf links that don't resolve \| 1 \|/);
	assert.match(md, /- \[\[R\/a\|a\]\]: `\[\[x\.pdf\]\]`\. Found \[\[R\/att\/a\.pdf\|a\.pdf\]\]/);
	assert.match(md, /Run \*\*Stacks: Relink PDFs\*\*/);
	assert.match(md, /- \[\[R\/a\|a\]\] and \[\[R\/b\|b\]\]: same DOI 10\.1000\/x/);
	assert.match(md, /\*\*Stacks: Review duplicates\*\*/);
	assert.doesNotMatch(md, /Nothing to fix/);
});
