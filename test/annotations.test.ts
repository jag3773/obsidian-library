// Annotation extraction against the real PDF.js (pdfjs-dist) on PDFs built like an external
// reader would write them.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error: pdfjs-dist ships .d.mts types that this tsconfig doesn't resolve; tests only.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
	END_MARKER,
	START_MARKER,
	applyAnnotationBlock,
	collectAnnotations,
	colorName,
	currentAnnotationBlock,
	joinLines,
	parseColorMap,
	renderAnnotations,
	DEFAULT_COLOR_MAP,
	PdfDocumentLike,
} from "../src/annotations";
import { PdfReadError, openPdf } from "../src/pdf";
import { FixturePage, buildPdf, lineQuad } from "./pdf-fixture";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function open(pages: FixturePage[], roman?: number): Promise<PdfDocumentLike & { destroy(): Promise<void> }> {
	return openPdf(pdfjs, buildPdf(pages, { roman }), "test.pdf");
}

async function extract(pages: FixturePage[], roman?: number) {
	const doc = await open(pages, roman);
	try {
		return await collectAnnotations(doc, pdfjs.OPS);
	} finally {
		await doc.destroy();
	}
}

const SENTENCE = "The quick brown fox jumps over the lazy dog.";

test("highlighted text is the words under the highlight, not the whole line", async () => {
	const r = await extract([
		{
			text: [{ x: 72, y: 700, text: SENTENCE }],
			// "quick brown" in 12pt Helvetica runs from about x=96 to x=160.
			annots: [{ subtype: "Highlight", rect: [96, 695, 160, 712], quads: lineQuad(96, 160, 700), color: [1, 0.83, 0] }],
		},
	]);
	assert.equal(r.annotations.length, 1);
	assert.equal(r.annotations[0].text, "quick brown");
	assert.equal(r.annotations[0].color, "yellow");
	assert.equal(r.annotations[0].kind, "highlight");
});

test("a highlight across lines joins them and undoes hyphenation", async () => {
	const r = await extract([
		{
			text: [
				{ x: 72, y: 700, text: "Reading becomes useful knowl-" },
				{ x: 72, y: 685, text: "edge when it is revisited." },
				{ x: 72, y: 670, text: "Not this line." },
			],
			annots: [{ subtype: "Underline", rect: [72, 680, 300, 712], quads: [...lineQuad(72, 300, 700), ...lineQuad(72, 300, 685)], color: [1, 0.4, 0.4] }],
		},
	]);
	assert.equal(r.annotations[0].text, "Reading becomes useful knowledge when it is revisited.");
	assert.equal(r.annotations[0].kind, "underline");
	assert.equal(r.annotations[0].color, "red");
	assert.equal(joinLines(["well-", "Known"]), "well- Known", "only lower-case continuations are dehyphenated");
});

test("comments, replies, sticky notes, page labels, ordering, and skipped drawings", async () => {
	const r = await extract(
		[
			{ text: [{ x: 72, y: 700, text: "Front matter" }] },
			{
				text: [
					{ x: 72, y: 700, text: "First line on the page." },
					{ x: 72, y: 600, text: "Lower line on the page." },
				],
				annots: [
					// Listed out of reading order on purpose.
					{ subtype: "Highlight", rect: [72, 595, 300, 612], quads: lineQuad(72, 300, 600), color: [0.37, 0.7, 0.21], contents: "Follow this up\nsecond line" },
					{ subtype: "Highlight", rect: [72, 695, 300, 712], quads: lineQuad(72, 300, 700), color: [0.18, 0.66, 0.9] },
					{ subtype: "Text", rect: [10, 10, 30, 30], contents: "A reply", replyTo: 0 },
					{ subtype: "Text", rect: [500, 750, 520, 770], contents: "Sticky note" },
					{ subtype: "Ink", rect: [0, 0, 50, 50] },
					{ subtype: "Link", rect: [0, 0, 50, 50] },
				],
			},
		],
		1
	);
	assert.deepEqual(
		r.annotations.map((a) => [a.kind, a.page, a.pageLabel, a.color, a.text, a.comments]),
		[
			["note", 2, "1", undefined, "", ["Sticky note"]],
			["highlight", 2, "1", "blue", "First line on the page.", []],
			["highlight", 2, "1", "green", "Lower line on the page.", ["Follow this up\nsecond line", "A reply"]],
		]
	);
	assert.equal(r.skipped, 1, "the ink drawing; links are part of the page");
	assert.equal(r.pageCount, 2);
});

// PR #37 review: word positions come from the font's own glyph widths, not Helvetica's.
test("highlights in a monospaced font select exactly the covered words", async () => {
	const text = "The minimum width is measured in millimeters.";
	// Courier is 0.6 em per glyph: "is measured in" spans x = 201.6 to 302.4 at 12pt from x = 72.
	const r = await extract([
		{ text: [{ x: 72, y: 700, text, font: "Courier" }], annots: [{ subtype: "Highlight", rect: [201.6, 695, 302.4, 712], quads: lineQuad(201.6, 302.4, 700), color: [1, 1, 0] }] },
	]);
	assert.equal(r.annotations[0].text, "is measured in");
	assert.deepEqual(r.pagesWithoutText, []);
	// Narrow highlights over each word come back as that word alone.
	const words = ["The", "minimum", "width", "is", "measured", "in", "millimeters."];
	let start = 0;
	const annots = words.map((w) => {
		const i = text.indexOf(w, start);
		start = i + w.length;
		const x1 = 72 + i * 7.2 + 1;
		const x2 = 72 + (i + w.length) * 7.2 - 1;
		return { subtype: "Highlight" as const, rect: [x1, 695, x2, 712], quads: lineQuad(x1, x2, 700), color: [1, 1, 0] };
	});
	const each = await extract([{ text: [{ x: 72, y: 700, text, font: "Courier" }], annots }]);
	assert.deepEqual(each.annotations.sort((a, b) => a.left - b.left).map((a) => a.text), words);
});

// PR #37 review: a reply to a reply belongs to the thread's highlight.
test("replies to replies are attached to the highlight that started the thread", async () => {
	const r = await extract([
		{
			text: [{ x: 72, y: 700, text: "A claim worth discussing." }],
			annots: [
				{ subtype: "Highlight", rect: [72, 695, 300, 712], quads: lineQuad(72, 300, 700), color: [1, 1, 0], contents: "Root comment" },
				{ subtype: "Text", rect: [10, 10, 30, 30], contents: "First reply", replyTo: 0 },
				{ subtype: "Text", rect: [10, 40, 30, 60], contents: "Reply to the reply", replyTo: 1 },
				{ subtype: "Ink", rect: [0, 0, 50, 50] },
				{ subtype: "Text", rect: [10, 70, 30, 90], contents: "Reply to a drawing", replyTo: 3 },
			],
		},
	]);
	assert.equal(r.annotations.length, 1);
	assert.deepEqual(r.annotations[0].comments, ["Root comment", "First reply", "Reply to the reply"]);
	assert.equal(r.skipped, 2, "the drawing and the reply to it are counted, not silently dropped");
});

test("ids are stable when a reader rewrites the file in a different object order", async () => {
	const a = { subtype: "Highlight" as const, rect: [72, 695, 300, 712], quads: lineQuad(72, 300, 700), color: [1, 1, 0] };
	const b = { subtype: "Highlight" as const, rect: [72, 595, 300, 612], quads: lineQuad(72, 300, 600), color: [1, 1, 0] };
	const text = [
		{ x: 72, y: 700, text: "One" },
		{ x: 72, y: 600, text: "Two" },
	];
	const first = await extract([{ text, annots: [a, b] }]);
	const second = await extract([{ text, annots: [b, { ...a, contents: "comment added later" }] }]);
	assert.deepEqual(
		first.annotations.map((x) => x.id),
		second.annotations.map((x) => x.id)
	);
	assert.equal(new Set(first.annotations.map((x) => x.id)).size, 2);
});

test("highlights on a page without text are reported and kept as page embeds", async () => {
	const r = await extract([{ annots: [{ subtype: "Highlight", rect: [72, 600, 300, 700], quads: lineQuad(72, 300, 650, 40), color: [1, 1, 0] }] }]);
	assert.deepEqual(r.pagesWithoutText, [1]);
	assert.equal(r.annotations[0].text, "");
	const md = renderAnnotations(r.annotations, { linktext: "scan.pdf", colors: parseColorMap(DEFAULT_COLOR_MAP).map, pageHeadingLevel: 3 });
	assert.match(md, /^> !\[\[scan\.pdf#page=1\]\]$/m);
});

test("unreadable PDFs are diagnosed", async () => {
	await assert.rejects(openPdf(pdfjs, new TextEncoder().encode("not a pdf"), "bad.pdf"), (e: unknown) => e instanceof PdfReadError && e.reason === "unreadable");
	const fakePdfjs = { getDocument: () => ({ promise: Promise.reject(Object.assign(new Error("No password given"), { name: "PasswordException" })) }) };
	await assert.rejects(openPdf(fakePdfjs, new Uint8Array(), "locked.pdf"), (e: unknown) => e instanceof PdfReadError && e.reason === "encrypted" && /password-protected/.test(e.message));
});

test("colors are named by hue across readers' shades", () => {
	const zotero: Record<string, string> = { "#ffd400": "yellow", "#ff6666": "red", "#5fb236": "green", "#2ea8e5": "blue", "#a28ae5": "purple", "#e56eee": "magenta", "#f19837": "orange", "#aaaaaa": "gray" };
	for (const [hex, name] of Object.entries(zotero)) assert.equal(colorName([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))), name, hex);
	assert.equal(colorName([255, 255, 0]), "yellow");
	assert.equal(colorName([0, 0, 255]), "blue");
});

test("the color map parses names, hex colors and labels, and reports what it can't read", () => {
	const { map, errors } = parseColorMap("yellow: quote, Quote\n#ff6666: danger\ngrey: note, Aside\nchartreuse: tip\nnonsense\n# a comment");
	assert.deepEqual(map.yellow, { callout: "quote", label: "Quote" });
	assert.deepEqual(map.red, { callout: "danger", label: "Danger" });
	assert.deepEqual(map.gray, { callout: "note", label: "Aside" });
	assert.deepEqual(errors, ["chartreuse: tip", "nonsense"]);
	assert.deepEqual(parseColorMap(DEFAULT_COLOR_MAP).errors, []);
});

test("rendering groups by page, links each item to its page, nests comments, and escapes PDF text", async () => {
	const r = await extract(
		[
			{
				text: [{ x: 72, y: 700, text: "Text with [[brackets]] and *stars*" }],
				annots: [{ subtype: "Highlight", rect: [72, 695, 400, 712], quads: lineQuad(72, 400, 700), color: [1, 0.4, 0.4], contents: "Why <b>this</b>?" }],
			},
		],
		1
	);
	const md = renderAnnotations(r.annotations, { linktext: "smith2020.pdf", colors: parseColorMap(DEFAULT_COLOR_MAP).map, pageHeadingLevel: 3 });
	const id = r.annotations[0].id;
	assert.equal(
		md,
		[
			"### Page i",
			"",
			"> [!important] Important · [[smith2020.pdf#page=1|p. i]]",
			"> Text with \\[\\[brackets\\]\\] and \\*stars\\*",
			">",
			"> > [!note] Comment",
			"> > Why \\<b\\>this\\</b\\>?",
			"",
			`^ann-${id}`,
		].join("\n")
	);
});

test("the block replaces only what is between the markers", () => {
	const note = "---\ntitle: x\n---\n# Title\n\nMy thoughts.\n\n## Annotations\n\nMy note above the block.\n";
	const once = applyAnnotationBlock(note, "> [!quote] one", "## Annotations");
	assert.equal(once, `---\ntitle: x\n---\n# Title\n\nMy thoughts.\n\n## Annotations\n\n${START_MARKER}\n> [!quote] one\n${END_MARKER}\n\nMy note above the block.\n`);
	const edited = once.replace("My thoughts.", "My thoughts, edited.") + "\nWritten after.\n";
	const twice = applyAnnotationBlock(edited, "> [!quote] two", "## Annotations");
	assert.equal(currentAnnotationBlock(twice), "> [!quote] two");
	assert.match(twice, /My thoughts, edited\./);
	assert.match(twice, /My note above the block\./);
	assert.match(twice, /Written after\./);
	assert.equal(applyAnnotationBlock(twice, "> [!quote] two", "## Annotations"), twice, "idempotent");
	const emptied = applyAnnotationBlock(twice, "", "## Annotations");
	assert.equal(currentAnnotationBlock(emptied), "");
	// No heading in the note: added at the end.
	assert.equal(applyAnnotationBlock("Body", "x", "## Annotations"), `Body\n\n## Annotations\n\n${START_MARKER}\nx\n${END_MARKER}\n`);
	// A heading-like line inside frontmatter is not the heading.
	assert.match(applyAnnotationBlock("---\na: '## Annotations'\n---\nBody\n", "x", "## Annotations"), /Body\n\n## Annotations\n\n<!--/);
});

test("page links can't be broken by an odd attachment name", () => {
	const md = renderAnnotations(
		[{ id: "abc123", kind: "highlight", page: 2, pageLabel: "2", color: "yellow", text: "t", comments: [], top: 0, left: 0 }],
		{ linktext: "odd]]name|x.pdf", colors: {}, pageHeadingLevel: 3 }
	);
	assert.match(md, /\[\[odd {2}name x\.pdf#page=2\|p\. 2\]\]/);
});
