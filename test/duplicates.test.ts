import { test } from "node:test";
import assert from "node:assert/strict";
import { describeReason, findDuplicates, mergeBody, mergeFrontmatter, normalizeTitle, normalizeUrl, preferredKeeper, splitNote } from "../src/duplicates";
import { DEFAULT_PROPERTY_NAMES } from "../src/properties";

const opts = { properties: DEFAULT_PROPERTY_NAMES, urlProperties: ["url", "source"] };
const note = (path: string, frontmatter: Record<string, unknown>) => ({ path, basename: path.replace(/^.*\//, "").replace(/\.md$/, ""), frontmatter });

test("normalizeTitle ignores case, accents and punctuation", () => {
	assert.equal(normalizeTitle("  Café: The   Story—Part 1! "), "cafe the story part 1");
});

test("normalizeUrl lowers the host and drops a trailing slash, nothing else", () => {
	assert.equal(normalizeUrl("HTTPS://Example.ORG/Path/"), "https://example.org/Path");
	assert.equal(normalizeUrl("https://example.org/a?b=1"), "https://example.org/a?b=1");
	assert.equal(normalizeUrl("example.org"), undefined);
});

test("findDuplicates matches DOI, ISBN (either form), URL and title + year, with reasons", () => {
	const groups = findDuplicates(
		[
			note("R/a.md", { doi: "https://doi.org/10.1000/ABC" }),
			note("R/b.md", { doi: "10.1000/abc" }),
			note("R/c.md", { isbn: "0-306-40615-2" }),
			note("R/d.md", { isbn: "9780306406157" }),
			note("R/e.md", { url: "https://example.org/x/" }),
			note("R/f.md", { source: "https://EXAMPLE.org/x" }),
			note("R/g.md", { title: "The Book", year: 2020 }),
			note("R/h.md", { title: "the book.", published: "2020-05-01" }),
			note("R/i.md", { title: "The Book", year: 2021 }),
			note("R/j.md", { title: "Unrelated" }),
		],
		opts
	);
	assert.deepEqual(
		groups.map((g) => [g.paths, g.pairs.map((p) => p.reasons.map(describeReason))]),
		[
			[["R/a.md", "R/b.md"], [["same DOI 10.1000/abc"]]],
			[["R/c.md", "R/d.md"], [["same ISBN 9780306406157"]]],
			[["R/e.md", "R/f.md"], [["same URL https://example.org/x"]]],
			[["R/g.md", "R/h.md"], [["same title and year: the book (2020)"]]],
		]
	);
});

test("findDuplicates joins chains into one group and lists every reason", () => {
	const groups = findDuplicates(
		[
			note("R/a.md", { doi: "10.1000/x", title: "T", year: 2000 }),
			note("R/b.md", { doi: "10.1000/x", title: "T", year: 2000 }),
			note("R/c.md", { url: "https://e.org/1", title: "T", year: 2000 }),
		],
		opts
	);
	assert.equal(groups.length, 1);
	assert.deepEqual(groups[0].paths, ["R/a.md", "R/b.md", "R/c.md"]);
	const ab = groups[0].pairs.find((p) => p.a === "R/a.md" && p.b === "R/b.md");
	assert.deepEqual(ab?.reasons.map((r) => r.kind), ["doi", "title-year"]);
});

test("findDuplicates never matches on a title without a year", () => {
	assert.deepEqual(findDuplicates([note("R/a.md", { title: "Same" }), note("R/b.md", { title: "Same" })], opts), []);
});

test("preferredKeeper is the one note named after its citekey, else undefined", () => {
	const a = note("R/smith2020.md", { citekey: "smith2020" });
	const b = note("R/smith2020a.md", { citekey: "smith2020b" });
	assert.equal(preferredKeeper([a, b], "citekey"), "R/smith2020.md");
	assert.equal(preferredKeeper([b, note("R/x.md", { citekey: "y" })], "citekey"), undefined);
	assert.equal(preferredKeeper([a, note("R/k.md", { citekey: "k" })], "citekey"), undefined);
});

test("mergeFrontmatter unions lists, fills empty properties, and replaces nothing", () => {
	const keep = { citekey: "a", title: "Kept", collections: ["[[Climate]]"], tags: ["x"], publisher: "", status: "reading" };
	const drop = { citekey: "b", title: "Dropped", collections: ["[[climate]]", "[[Water]]"], tags: "y", publisher: "Press", status: "queued", pdf: "[[b.pdf]]" };
	const { updates, changes } = mergeFrontmatter(keep, drop, { listProperties: ["collections", "tags", "attachments"], skip: ["citekey"] });
	assert.deepEqual(updates, { collections: ["[[Climate]]", "[[Water]]"], tags: ["x", "y"], publisher: "Press", pdf: "[[b.pdf]]" });
	assert.deepEqual(
		changes.map((c) => [c.property, c.kind]),
		[
			["collections", "union"],
			["tags", "union"],
			["publisher", "fill"],
			["pdf", "fill"],
		]
	);
});

test("mergeBody copies the annotations block into an empty one", () => {
	const keep = "# Title\n\n## Annotations\n";
	const drop = "# Title\n\n## Annotations\n\n<!-- stacks:annotations:start -->\n> [!quote] Highlight\n> text\n\n^ann-1\n<!-- stacks:annotations:end -->\n";
	const r = mergeBody(keep, drop, { dropName: "b", annotationsHeading: "## Annotations" });
	assert.equal(r.annotationsCopied, true);
	assert.equal(r.paragraphsAdded, 0);
	assert.match(r.body, /<!-- stacks:annotations:start -->\n> \[!quote\] Highlight\n> text\n\n\^ann-1\n<!-- stacks:annotations:end -->/);
	assert.doesNotMatch(r.body, /Merged from/);
});

test("mergeBody adds only paragraphs the kept note lacks, with their heading, outside the markers", () => {
	const keep = "# Title\n\nShared idea.\n\n## Annotations\n\n<!-- stacks:annotations:start -->\n> [!quote] A\n\n^ann-1\n<!-- stacks:annotations:end -->\n";
	const drop = "# Title\n\nShared   idea.\n\n## My thoughts\n\nOnly here.\n\n## Annotations\n\n<!-- stacks:annotations:start -->\n> [!quote] A\n\n^ann-1\n\n> [!quote] B\n\n^ann-2\n<!-- stacks:annotations:end -->\n";
	const r = mergeBody(keep, drop, { dropName: "smith2020a", annotationsHeading: "## Annotations" });
	assert.equal(r.annotationsCopied, false);
	assert.equal(r.paragraphsAdded, 3);
	assert.ok(r.body.startsWith(keep));
	assert.equal(r.body.slice(keep.length), "\n## Merged from smith2020a\n\n### My thoughts\n\nOnly here.\n\n### Annotations\n\n> [!quote] B\n\n^ann-2\n");
	// Nothing new: unchanged.
	assert.equal(mergeBody(keep, keep, { dropName: "x", annotationsHeading: "## Annotations" }).body, keep);
});

test("splitNote separates frontmatter from the body", () => {
	assert.deepEqual(splitNote("---\na: 1\n---\nBody"), { frontmatter: "---\na: 1\n---\n", body: "Body" });
	assert.deepEqual(splitNote("Body only"), { frontmatter: "", body: "Body only" });
	assert.deepEqual(splitNote("---\ntitle: a---b\n---\nBody"), { frontmatter: "---\ntitle: a---b\n---\n", body: "Body" });
	assert.deepEqual(splitNote("---\n---\nBody"), { frontmatter: "---\n---\n", body: "Body" });
});
