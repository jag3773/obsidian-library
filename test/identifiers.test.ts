import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalIsbn, detectIdentifier, findIdentifierInText, normalizeDoi, normalizeIsbn } from "../src/identifiers";
import { MAX_FILENAME_BYTES, escapeMarkdown, markdownSafeUrl, renderTemplate, safeFilename } from "../src/template";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
});

test("escapeMarkdown neutralises remote markup", () => {
	assert.equal(escapeMarkdown("`$= dv.x` ![x](http://t/p.png) <img> #tag"), "\\`\\$= dv.x\\` \\!\\[x\\](http://t/p.png) \\<img\\> \\#tag");
	assert.equal(escapeMarkdown("a\nb"), "a b");
});

// #8
test("safe filenames are bounded by encoded length and avoid Windows device names", () => {
	const emoji = safeFilename("😀".repeat(180));
	assert.ok(new TextEncoder().encode(emoji).length <= MAX_FILENAME_BYTES);
	assert.equal(emoji, "😀".repeat(MAX_FILENAME_BYTES / 4));
	assert.ok(new TextEncoder().encode(safeFilename("é".repeat(300))).length <= MAX_FILENAME_BYTES);
	assert.equal(safeFilename("CON"), "CON_");
	assert.equal(safeFilename("nul.tar"), "nul.tar_");
	assert.equal(safeFilename("Console"), "Console");
});

test("long non-ASCII filenames can actually be written, with a collision suffix", () => {
	const dir = mkdtempSync(join(tmpdir(), "reflib-"));
	try {
		for (const title of ["😀".repeat(180), "日本語のタイトル".repeat(40), "Ünïcödé ".repeat(60)]) {
			const base = safeFilename(title);
			assert.ok(base.length > 0);
			writeFileSync(join(dir, `${base}.md`), "x");
			writeFileSync(join(dir, `${base} 99.epub`), "x");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// #1
test("markdownSafeUrl encodes Markdown syntax but keeps the destination", () => {
	assert.equal(markdownSafeUrl("https://evil.example/?a=`$=1+1`"), "https://evil.example/?a=%60%24=1+1%60");
	const breakout = markdownSafeUrl("https://evil.example/)![](https://track.example/pixel)") as string;
	assert.ok(!/[()[\]!]/.test(breakout), breakout);
	assert.equal(decodeURIComponent(new URL(breakout).pathname), "/)![](https://track.example/pixel)");
	assert.equal(markdownSafeUrl("https://example.com/a_b?q=%%x"), "https://example.com/a%5Fb?q=%25%25x");
	assert.equal(markdownSafeUrl("https://example.com/path?x=1#frag"), "https://example.com/path?x=1#frag");
	assert.equal(markdownSafeUrl("javascript:alert(1)"), undefined);
});

test("templates using {{url}} can't be broken out of", () => {
	const url = markdownSafeUrl("https://evil.example/)![](https://track.example/pixel)");
	const out = renderTemplate("[Source]({{url}}) Source: {{url}}", { url });
	assert.ok(!out.includes("![]"), out);
	assert.equal(out.match(/\)/g)?.length, 1);
	assert.ok(!renderTemplate("Source: {{url}}", { url: markdownSafeUrl("https://e.example/?a=`$=1`") }).includes("`"));
});

// #5
test("explicit DOIs keep legacy punctuation", () => {
	const asce = "10.1061/(ASCE)0733-9437(1993)119:2(334)";
	const wiley = "10.1002/(SICI)1099-0844(199912)17:4<290::AID-CBF849>3.0.CO;2-P";
	for (const d of [asce, wiley]) {
		assert.equal(normalizeDoi(d), d);
		assert.deepEqual(detectIdentifier(d), { kind: "doi", value: d });
		assert.deepEqual(detectIdentifier(`https://doi.org/${encodeURIComponent(d)}`), { kind: "doi", value: d });
	}
	assert.equal(normalizeDoi("10.1234/a"), "10.1234/a");
});

test("DOIs in prose lose only surrounding punctuation", () => {
	const asce = "10.1061/(ASCE)0733-9437(1993)119:2(334)";
	const wiley = "10.1002/(SICI)1099-0844(199912)17:4<290::AID-CBF849>3.0.CO;2-P";
	assert.equal(findIdentifierInText(`see doi:${asce}. Next`)?.value, asce);
	assert.equal(findIdentifierInText(`(doi: ${asce})`)?.value, asce);
	assert.equal(findIdentifierInText(`DOI ${wiley}, received`)?.value, wiley);
	assert.equal(findIdentifierInText("(see 10.1000/xyz123).")?.value, "10.1000/xyz123");
	assert.equal(findIdentifierInText("doi 10.1234/a; other")?.value, "10.1234/a");
});

// #9
test("canonical ISBNs make ISBN-10 and ISBN-13 comparable", () => {
	assert.equal(canonicalIsbn("014312837X"), canonicalIsbn("9780143128373"));
	assert.equal(canonicalIsbn("0-14-312837-X"), "9780143128373");
	assert.equal(canonicalIsbn("080442957X"), "9780804429573");
	assert.equal(canonicalIsbn("9791034304370"), "9791034304370");
	assert.equal(canonicalIsbn("0143128370"), null);
});

// #11
test("detects old-scheme arXiv IDs", () => {
	for (const [input, value] of [
		["hep-th/9901001", "hep-th/9901001"],
		["arXiv:hep-th/9901001", "hep-th/9901001"],
		["math.GT/0309136v1", "math.GT/0309136v1"],
		["https://arxiv.org/abs/hep-th/9901001v2", "hep-th/9901001v2"],
		["https://arxiv.org/pdf/cond-mat/0207270.pdf", "cond-mat/0207270"],
	]) {
		assert.deepEqual(detectIdentifier(input), { kind: "arxiv", value }, input);
	}
	assert.deepEqual(detectIdentifier("arXiv:2303.08774"), { kind: "arxiv", value: "2303.08774" });
});
