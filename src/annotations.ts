/**
 * PDF annotations to Markdown. Pure module: it takes a PDF.js document (or plain data) and
 * returns text, so it is tested in Node against the real pdfjs-dist.
 *
 * Highlighted text is not stored in most PDFs: a highlight is a set of quadrilaterals on
 * the page. The text is recovered by intersecting those quads with the page's text items.
 */

import { escapeMarkdown } from "./template";

// ---------------------------------------------------------------- types

export type AnnotationKind = "highlight" | "underline" | "strikeout" | "squiggly" | "note" | "image";

export interface Annotation {
	/** Stable across re-extraction: page, kind and position (not PDF object numbers, which a re-save can change). */
	id: string;
	kind: AnnotationKind;
	/** 1-based page index, for links. */
	page: number;
	/** The page's label as the PDF names it (e.g. "iv"), or the page number. */
	pageLabel: string;
	/** Named color from the palette, or undefined when the annotation has none. */
	color?: string;
	/** Text under a highlight-like annotation. Empty when the page has no text layer there. */
	text: string;
	/** The annotation's own comment, then comments from replies. */
	comments: string[];
	/** Top of the annotation on the page, for ordering (higher is earlier). */
	top: number;
	left: number;
}

export interface ExtractResult {
	annotations: Annotation[];
	pageCount: number;
	/** Annotations of kinds the extractor doesn't turn into text (ink, shapes, stamps). */
	skipped: number;
	/** Pages with annotations but no text at all: likely scanned images. */
	pagesWithoutText: number[];
}

/** The parts of a PDF.js document this module reads. */
export interface PdfDocumentLike {
	numPages: number;
	getPage(n: number): Promise<PdfPageLike>;
	getPageLabels(): Promise<string[] | null>;
}
export interface PdfPageLike {
	getAnnotations(params?: { intent?: string }): Promise<RawAnnotation[]>;
	getTextContent(): Promise<{ items: unknown[] }>;
	/** Used for glyph widths when available (PDF.js always has it). */
	getOperatorList?(): Promise<{ fnArray: ArrayLike<number>; argsArray: unknown[] }>;
}
/** PDF.js's operator codes, from the module (pdfjs.OPS). */
export interface PdfOps {
	setFont: number;
	showText: number;
}
export interface RawAnnotation {
	id?: string;
	subtype?: string;
	rect?: ArrayLike<number>;
	quadPoints?: ArrayLike<number> | { x: number; y: number }[][] | null;
	color?: ArrayLike<number> | null;
	contentsObj?: { str?: string } | null;
	contents?: string;
	inReplyTo?: string;
}
export interface TextItem {
	str: string;
	transform: number[];
	width: number;
	height: number;
	hasEOL?: boolean;
	fontName?: string;
}

/** Each font's glyph widths by character, from the page's drawing operations. */
export type FontWidths = Map<string, Map<string, number>>;

// ---------------------------------------------------------------- colors

/**
 * Hue ranges (degrees) for named colors. Readers use different shades of the same few
 * colors; ranges put each shade on its name. Zotero's palette sits well inside each range.
 */
const HUES: [number, string][] = [
	[15, "red"],
	[42, "orange"],
	[70, "yellow"],
	[165, "green"],
	[190, "cyan"],
	[248, "blue"],
	[285, "purple"],
	[345, "magenta"],
	[360, "red"],
];
export const COLOR_NAMES = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta", "gray"];

/** Name the color of an RGB triple (0-255). Low saturation or near-black/white is gray. */
export function colorName(rgb: ArrayLike<number>): string {
	const [r, g, b] = [rgb[0], rgb[1], rgb[2]].map((v) => (v ?? 0) / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
	if (s < 0.2 || l < 0.08 || l > 0.97) return "gray";
	let h: number;
	if (max === r) h = 60 * (((g - b) / d) % 6);
	else if (max === g) h = 60 * ((b - r) / d + 2);
	else h = 60 * ((r - g) / d + 4);
	if (h < 0) h += 360;
	return (HUES.find(([end]) => h < end) ?? HUES[0])[1];
}

export interface ColorRule {
	callout: string;
	label: string;
}
export type ColorMap = Record<string, ColorRule>;

export const DEFAULT_COLOR_MAP = `yellow: quote, Quote
red: important, Important
green: tip, Follow up
blue: example, Image
default: quote, Highlight
note: note, Note`;

/**
 * Parse "color: callout, Label" lines. "default" covers colors without a line, "note" is
 * used for sticky notes and text boxes. Colors may be palette names or #rrggbb (matched to
 * the nearest palette name). Unparseable lines are reported, not dropped silently.
 */
export function parseColorMap(text: string): { map: ColorMap; errors: string[] } {
	const map: ColorMap = {};
	const errors: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#") && !/^#[0-9a-f]{6}\s*:/i.test(line)) continue;
		const m = /^([#\w-]+)\s*:\s*([\w-]+)\s*(?:,\s*(.+))?$/.exec(line);
		if (!m) {
			errors.push(line);
			continue;
		}
		let key = m[1].toLowerCase();
		if (/^#[0-9a-f]{6}$/.test(key)) key = colorName([1, 3, 5].map((i) => parseInt(key.slice(i, i + 2), 16)));
		else if (key === "grey") key = "gray";
		else if (!COLOR_NAMES.includes(key) && key !== "default" && key !== "note") {
			errors.push(line);
			continue;
		}
		const callout = m[2].toLowerCase();
		map[key] = { callout, label: (m[3] ?? "").trim() || callout[0].toUpperCase() + callout.slice(1) };
	}
	return { map, errors };
}

export function ruleFor(a: Annotation, map: ColorMap): ColorRule {
	if (a.kind === "note") return map.note ?? { callout: "note", label: "Note" };
	return (a.color && map[a.color]) || map.default || { callout: "quote", label: "Highlight" };
}

// ---------------------------------------------------------------- geometry

interface Box {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

/** One box per quad. Accepts PDF.js 3's [[{x,y}×4]] and 4's flat [x,y ×4] forms, in any corner order. */
export function quadBoxes(quads: RawAnnotation["quadPoints"], rect?: ArrayLike<number>): Box[] {
	const out: Box[] = [];
	const push = (xs: number[], ys: number[]) => out.push({ x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) });
	if (quads && Array.isArray(quads) && quads.length && typeof quads[0] === "object") {
		for (const q of quads as { x: number; y: number }[][]) push(q.map((p) => p.x), q.map((p) => p.y));
	} else if (quads && (quads as ArrayLike<number>).length >= 8) {
		const flat = quads as ArrayLike<number>;
		for (let i = 0; i + 8 <= flat.length; i += 8) {
			push([flat[i], flat[i + 2], flat[i + 4], flat[i + 6]], [flat[i + 1], flat[i + 3], flat[i + 5], flat[i + 7]]);
		}
	}
	if (!out.length && rect && rect.length >= 4) push([rect[0], rect[2]], [rect[1], rect[3]]);
	return out;
}

/**
 * Relative glyph widths, roughly Helvetica's: the fallback when the font's own widths aren't
 * known. PDF.js gives one text item per run of text, not per glyph.
 */
function glyphWidth(c: string): number {
	if (c === " ") return 0.28;
	if (/[il.,;:'!|ìíîïĺļľłı]/.test(c)) return 0.25;
	if (/[jft()[\]/\\r"-]/.test(c)) return 0.35;
	if (/[mwMW]/.test(c)) return 0.85;
	if (/[A-Z]/.test(c)) return 0.68;
	if (/[　-鿿가-힯＀-￯]/.test(c)) return 1;
	return 0.55;
}

const isTextItem = (v: unknown): v is TextItem =>
	!!v && typeof (v as TextItem).str === "string" && Array.isArray((v as TextItem).transform);

/**
 * The part of one text item inside a box: words whose middle falls inside it horizontally,
 * when the item's line overlaps the box vertically by at least half the line height.
 * Whole words, because readers' quads rarely end exactly on a glyph edge.
 */
function textInBox(item: TextItem, box: Box, fontWidths?: Map<string, number>): string {
	const [a, b, , d, x, y] = item.transform;
	// Rotated text: only take it when the whole item sits inside the box.
	const h = Math.abs(d) || item.height || 1;
	const top = y + h * 0.8;
	const bottom = y - h * 0.2;
	const overlap = Math.min(top, box.y2) - Math.max(bottom, box.y1);
	if (b !== 0 || a <= 0) {
		return x >= box.x1 - 1 && x <= box.x2 + 1 && y >= box.y1 - 1 && y <= box.y2 + 1 ? item.str : "";
	}
	if (overlap < Math.min(top - bottom, box.y2 - box.y1) * 0.5) return "";
	const chars = [...item.str];
	// The font's real widths when every character has one; otherwise the estimate. Either way the
	// widths are scaled to the run's measured width, so only their proportions matter.
	const known = fontWidths && chars.every((c) => fontWidths.has(c));
	const width = (c: string) => (known ? (fontWidths as Map<string, number>).get(c) as number : glyphWidth(c));
	const total = chars.reduce((n, c) => n + width(c), 0) || 1;
	const scale = (item.width || 0) / total;
	let pos = x;
	const xs = chars.map((c) => {
		const start = pos;
		pos += width(c) * scale;
		return { c, mid: (start + pos) / 2 };
	});
	// Group into words and spaces, keeping the spaces between kept words.
	const words: { s: string; mid: number; space: boolean }[] = [];
	for (const { c, mid } of xs) {
		const space = /\s/.test(c);
		const last = words[words.length - 1];
		if (last && last.space === space && !/[　-鿿]/.test(c)) {
			last.mid = (last.mid * last.s.length + mid) / (last.s.length + 1);
			last.s += c;
		} else words.push({ s: c, mid, space });
	}
	const inside = words.map((w) => !w.space && w.mid >= box.x1 && w.mid <= box.x2);
	const first = inside.indexOf(true);
	const last = inside.lastIndexOf(true);
	return first === -1 ? "" : words.slice(first, last + 1).map((w) => w.s).join("");
}

/** Join lines of highlighted text, undoing end-of-line hyphenation ("hyphen-\nation"). */
export function joinLines(lines: string[]): string {
	let out = "";
	for (const raw of lines) {
		const line = raw.replace(/\s+/g, " ").trim();
		if (!line) continue;
		if (!out) out = line;
		else if (/\p{Ll}-$/u.test(out) && /^\p{Ll}/u.test(line)) out = out.slice(0, -1) + line;
		else if (/[　-鿿]$/.test(out) && /^[　-鿿]/.test(line)) out += line;
		else out += " " + line;
	}
	return out;
}

/** Text of the page under the given boxes, in reading order. */
export function textUnder(items: unknown[], boxes: Box[], widths?: FontWidths): string {
	const lines: string[] = [];
	for (const box of boxes) {
		const parts: string[] = [];
		for (const it of items) if (isTextItem(it) && it.str) {
			const t = textInBox(it, box, it.fontName ? widths?.get(it.fontName) : undefined);
			if (t) parts.push(t);
		}
		lines.push(parts.join(" "));
	}
	return joinLines(lines);
}

// ---------------------------------------------------------------- extraction

const KINDS: Record<string, AnnotationKind> = {
	Highlight: "highlight",
	Underline: "underline",
	StrikeOut: "strikeout",
	Squiggly: "squiggly",
	Text: "note",
	FreeText: "note",
	Square: "image",
};
/** Subtypes that are part of the page, not a reader's annotation. */
const IGNORED = new Set(["Link", "Widget", "Popup"]);

/** FNV-1a, as 6 base-36 characters: short enough for a block ID, wide enough for one document. */
export function shortHash(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36).padStart(6, "0").slice(-6);
}

/**
 * Glyph widths per font, read from the page's operator list: setFont names the font (the same
 * name text items carry), showText lists glyphs with their character and advance width.
 */
export async function fontWidths(page: PdfPageLike, ops?: PdfOps): Promise<FontWidths | undefined> {
	if (!ops || !page.getOperatorList) return undefined;
	try {
		const list = await page.getOperatorList();
		const out: FontWidths = new Map();
		let font = "";
		for (let i = 0; i < list.fnArray.length; i++) {
			const fn = list.fnArray[i];
			const args = list.argsArray[i] as unknown[] | null;
			if (fn === ops.setFont && args && typeof args[0] === "string") font = args[0];
			else if (fn === ops.showText && font && Array.isArray(args?.[0])) {
				let m = out.get(font);
				if (!m) out.set(font, (m = new Map()));
				for (const g of args[0] as unknown[]) {
					const glyph = g as { unicode?: unknown; width?: unknown } | number | null;
					if (glyph && typeof glyph === "object" && typeof glyph.unicode === "string" && typeof glyph.width === "number" && glyph.unicode)
						m.set(glyph.unicode, glyph.width);
				}
			}
		}
		return out;
	} catch {
		return undefined;
	}
}

/**
 * Comments that reply to each retained annotation, following reply chains (a reply to a reply)
 * up to the annotation that started the thread. Replies whose thread starts at an annotation
 * that isn't kept, or that loop, are counted as orphans.
 */
function replyThreads(raw: RawAnnotation[], isReply: (a: RawAnnotation) => boolean, retained: Set<string>): { threads: Map<string, string[]>; orphans: number } {
	const byId = new Map(raw.filter((a) => a.id).map((a) => [a.id as string, a]));
	const threads = new Map<string, string[]>();
	let orphans = 0;
	for (const a of raw) {
		if (!isReply(a)) continue;
		const c = commentOf(a);
		let parent = a.inReplyTo;
		const visited = new Set<string>([a.id ?? ""]);
		while (parent && !retained.has(parent)) {
			const p = byId.get(parent);
			if (!p || visited.has(parent) || !isReply(p)) {
				parent = undefined;
				break;
			}
			visited.add(parent);
			parent = p.inReplyTo;
		}
		if (!parent) {
			if (c) orphans++;
			continue;
		}
		if (c) threads.set(parent, [...(threads.get(parent) ?? []), c]);
	}
	return { threads, orphans };
}

const commentOf = (a: RawAnnotation) => (a.contentsObj?.str ?? a.contents ?? "").replace(/\r\n?/g, "\n").trim();

/** Read every supported annotation in a document. */
export async function collectAnnotations(doc: PdfDocumentLike, ops?: PdfOps): Promise<ExtractResult> {
	const labels = await doc.getPageLabels().catch(() => null);
	const annotations: Annotation[] = [];
	const pagesWithoutText: number[] = [];
	let skipped = 0;
	const seen = new Set<string>();
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n);
		const raw = (await page.getAnnotations({ intent: "display" })).filter((a) => a.subtype && !IGNORED.has(a.subtype));
		if (!raw.length) continue;
		const isReply = (a: RawAnnotation) => !!a.inReplyTo && (a.subtype === "Text" || a.subtype === "FreeText");
		const own: RawAnnotation[] = [];
		for (const a of raw) {
			if (isReply(a)) continue;
			if (KINDS[a.subtype as string]) own.push(a);
			else skipped++;
		}
		const { threads: replies, orphans } = replyThreads(raw, isReply, new Set(own.map((a) => a.id).filter((id): id is string => !!id)));
		skipped += orphans;
		if (!own.length) continue;
		const items = (await page.getTextContent()).items;
		const hasText = items.some((i) => isTextItem(i) && i.str.trim());
		const widths = hasText && own.some((a) => KINDS[a.subtype as string] !== "note" && KINDS[a.subtype as string] !== "image") ? await fontWidths(page, ops) : undefined;
		let usedTextlessPage = false;
		for (const a of own) {
			const kind = KINDS[a.subtype as string];
			const boxes = quadBoxes(kind === "note" || kind === "image" ? null : a.quadPoints, a.rect);
			const text = kind === "note" || kind === "image" || !hasText ? "" : textUnder(items, boxes, widths);
			const comments = [commentOf(a), ...(a.id ? replies.get(a.id) ?? [] : [])].filter(Boolean);
			if (kind === "note" && !comments.length) continue;
			if (!text && kind !== "note") usedTextlessPage ||= !hasText;
			const top = boxes.length ? Math.max(...boxes.map((b) => b.y2)) : 0;
			const left = boxes.length ? Math.min(...boxes.map((b) => b.x1)) : 0;
			// Position rounded to whole points: stable when a reader re-saves the file.
			const r = boxes.map((b) => [b.x1, b.y1, b.x2, b.y2].map(Math.round).join(",")).join(";");
			let id = shortHash(`${n}|${kind}|${r}`);
			for (let i = 1; seen.has(id); i++) id = shortHash(`${n}|${kind}|${r}|${i}`);
			seen.add(id);
			annotations.push({
				id,
				kind,
				page: n,
				pageLabel: labels?.[n - 1]?.trim() || String(n),
				color: a.color && a.color.length >= 3 ? colorName(a.color) : kind === "highlight" ? "yellow" : undefined,
				text,
				comments,
				top,
				left,
			});
		}
		if (usedTextlessPage) pagesWithoutText.push(n);
	}
	annotations.sort((x, y) => x.page - y.page || y.top - x.top || x.left - y.left);
	return { annotations, pageCount: doc.numPages, skipped, pagesWithoutText };
}

// ---------------------------------------------------------------- rendering

export const START_MARKER = "<!-- stacks:annotations:start -->";
export const END_MARKER = "<!-- stacks:annotations:end -->";

export interface RenderOptions {
	/** Link target for the PDF, as fileToLinktext gives it (e.g. "smith2020.pdf"). */
	linktext: string;
	colors: ColorMap;
	/** Heading level for each page group (the annotations heading's level + 1). */
	pageHeadingLevel: number;
}

/** Comment text as callout lines: escaped like any text from a file, line breaks kept. */
function quoteLines(text: string, prefix: string): string[] {
	return text.split("\n").map((l) => (l.trim() ? `${prefix} ${escapeMarkdown(l.trim())}` : prefix));
}

/** Link text is used inside [[...]], so it must not close the link or start an alias. */
const safeLinktext = (s: string) => s.replace(/[[\]|#^]/g, " ");

/** Markdown for the annotations, without the markers. Empty when there are none. */
export function renderAnnotations(list: Annotation[], o: RenderOptions): string {
	if (!list.length) return "";
	const link = safeLinktext(o.linktext);
	const hashes = "#".repeat(Math.min(6, Math.max(1, o.pageHeadingLevel)));
	const out: string[] = [];
	let page = -1;
	for (const a of list) {
		if (a.page !== page) {
			page = a.page;
			const label = a.pageLabel === String(a.page) ? `Page ${a.page}` : `Page ${escapeMarkdown(a.pageLabel)}`;
			out.push(`${hashes} ${label}`, "");
		}
		const rule = ruleFor(a, o.colors);
		const pageLink = `[[${link}#page=${a.page}|p. ${escapeMarkdown(a.pageLabel)}]]`;
		const lines = [`> [!${rule.callout}] ${escapeMarkdown(rule.label)} · ${pageLink}`];
		if (a.text) lines.push(...quoteLines(a.text, ">"));
		else if (a.kind !== "note") lines.push(`> ![[${link}#page=${a.page}]]`);
		const [first, ...rest] = a.comments;
		if (a.kind === "note") {
			for (const c of a.comments) lines.push(...quoteLines(c, ">"));
		} else if (first !== undefined) {
			lines.push(">", "> > [!note] Comment", ...quoteLines(first, "> >"));
			for (const c of rest) lines.push("> >", ...quoteLines(c, "> >"));
		}
		// A block ID for a callout goes on its own line after a blank one.
		out.push(...lines, "", `^ann-${a.id}`, "");
	}
	return out.join("\n").trimEnd();
}

/**
 * Put the generated block into a note body. Replaces what is between the markers; without
 * markers, inserts them under the annotations heading (adding the heading at the end when the
 * note has none). Nothing outside the markers changes.
 */
export function applyAnnotationBlock(content: string, block: string, heading: string): string {
	const wrapped = `${START_MARKER}\n${block ? block + "\n" : ""}${END_MARKER}`;
	const start = content.indexOf(START_MARKER);
	const end = start === -1 ? -1 : content.indexOf(END_MARKER, start);
	if (start !== -1 && end !== -1) return content.slice(0, start) + wrapped + content.slice(end + END_MARKER.length);
	const h = heading.trim();
	if (h) {
		const lines = content.split("\n");
		const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
		const bodyStartLine = fm ? fm[0].split("\n").length - (fm[0].endsWith("\n") ? 1 : 0) : 0;
		const at = lines.findIndex((l, i) => i >= bodyStartLine && l.trim() === h);
		if (at !== -1) {
			lines.splice(at + 1, 0, "", wrapped);
			return lines.join("\n");
		}
	}
	const sep = content.endsWith("\n") ? "\n" : content ? "\n\n" : "";
	return `${content}${sep}${h ? h + "\n\n" : ""}${wrapped}\n`;
}

/** The block currently between the markers, or null when the note has none. */
export function currentAnnotationBlock(content: string): string | null {
	const start = content.indexOf(START_MARKER);
	const end = start === -1 ? -1 : content.indexOf(END_MARKER, start);
	return start === -1 || end === -1 ? null : content.slice(start + START_MARKER.length, end).trim();
}

/** Heading level of a Markdown heading line ("## Annotations" → 2), or 0. */
export function headingLevel(heading: string): number {
	return /^(#{1,6})\s/.exec(heading.trim())?.[1].length ?? 0;
}
