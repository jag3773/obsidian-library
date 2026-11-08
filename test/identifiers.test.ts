import { test } from "node:test";
import assert from "node:assert/strict";
import { detectIdentifier, findIdentifierInText, normalizeIsbn } from "../src/identifiers";
import { escapeMarkdown, renderTemplate, safeFilename } from "../src/template";

test("detects ISBN-13 with hyphens", () => {
	assert.deepEqual(detectIdentifier("978-0-14-312837-3"), { kind: "isbn", value: "9780143128373" });
});

test("detects ISBN-10 with X check digit", () => {
	assert.equal(normalizeIsbn("0-8044-2957-X"), "080442957X");
});

test("rejects a bad ISBN checksum", () => {
	assert.equal(normalizeIsbn("9780143128374"), null);
});

test("detects DOIs in several forms", () => {
	for (const s of ["10.1000/xyz123", "doi:10.1000/xyz123", "https://doi.org/10.1000/xyz123"]) {
		assert.deepEqual(detectIdentifier(s), { kind: "doi", value: "10.1000/xyz123" });
	}
});

test("detects arXiv IDs", () => {
	assert.deepEqual(detectIdentifier("arXiv:2303.08774"), { kind: "arxiv", value: "2303.08774" });
	assert.deepEqual(detectIdentifier("https://arxiv.org/abs/2303.08774v2"), { kind: "arxiv", value: "2303.08774v2" });
});

test("detects URLs, adding a scheme when missing", () => {
	assert.deepEqual(detectIdentifier("https://example.com/a"), { kind: "url", value: "https://example.com/a" });
	assert.deepEqual(detectIdentifier("example.com/a"), { kind: "url", value: "https://example.com/a" });
	assert.equal(detectIdentifier("just some words"), null);
});

test("finds a DOI or ISBN in PDF text", () => {
	assert.deepEqual(findIdentifierInText("Published as doi: 10.5555/12345678. All rights"), { kind: "doi", value: "10.5555/12345678" });
	assert.deepEqual(findIdentifierInText("ISBN 978-0-14-312837-3 Printed in USA"), { kind: "isbn", value: "9780143128373" });
});

test("template sections render only with values", () => {
	const t = "# {{title}}\n{{#abstract}}## Abstract\n{{abstract}}\n{{/abstract}}## Annotations\n";
	assert.equal(renderTemplate(t, { title: "X" }), "# X\n## Annotations\n");
	assert.equal(renderTemplate(t, { title: "X", abstract: "Y" }), "# X\n## Abstract\nY\n## Annotations\n");
});

test("safe filenames", () => {
	assert.equal(safeFilename('a: b/c?'), "a b c");
});

test("safe filenames drop leading/trailing dots and control characters", () => {
	assert.equal(safeFilename("..hidden"), "hidden");
	assert.equal(safeFilename("name. "), "name");
	assert.equal(safeFilename("a\u0000b"), "a b");
	assert.equal(Array.from(safeFilename("😀".repeat(200))).length, 180);
});

test("escapeMarkdown neutralises remote markup", () => {
	assert.equal(escapeMarkdown("`$= dv.x` ![x](http://t/p.png) <img> #tag"), "\\`\\$= dv.x\\` \\!\\[x\\](http://t/p.png) \\<img\\> \\#tag");
	assert.equal(escapeMarkdown("a\nb"), "a b");
});
