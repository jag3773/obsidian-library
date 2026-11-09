/**
 * Pure module: find internal links in a note's text and point them somewhere else.
 * Used to repoint links when duplicate references are merged. Wikilinks and Markdown links
 * are found in the whole text, frontmatter included; links inside code are skipped.
 */

export interface FoundLink {
	/** Offsets of the whole link in the text, `[[` (or `!`) to the closing bracket. */
	start: number;
	end: number;
	original: string;
	kind: "wiki" | "markdown";
	embed: boolean;
	/** The link path without its subpath, decoded, as Obsidian resolves it. */
	target: string;
	/** "#Heading", "#^block" or "" */
	subpath: string;
	/** Wikilink: "|alias" or "". Markdown: the text in brackets. */
	display: string;
}

const WIKI = /(!?)\[\[([^\]\n]+?)\]\]/g;
/** A Markdown link up to the "(" that opens its destination; parseDestination reads the rest. */
const MARKDOWN = /(!?)\[([^\]\n]*)\]\(/g;
const PUNCT = /[!-/:-@[-`{-~]/;

/**
 * A Markdown link's destination and optional title, read from just after "(" by CommonMark's
 * rules (on one line): `<…>`, or a run without spaces whose parentheses balance or are
 * escaped. Returns the destination with escapes removed and the offset after the closing ")",
 * or null when the text isn't a link.
 */
function parseDestination(text: string, from: number): { dest: string; end: number } | null {
	let i = from;
	const skipSpace = () => {
		while (text[i] === " " || text[i] === "\t") i++;
	};
	skipSpace();
	let dest = "";
	if (text[i] === "<") {
		for (i++; text[i] !== ">"; i++) {
			const c = text[i];
			if (c === undefined || c === "\n" || c === "<") return null;
			if (c === "\\" && PUNCT.test(text[i + 1] ?? "")) i++;
			dest += text[i];
		}
		i++;
	} else {
		let depth = 0;
		for (; i < text.length && !/\s/.test(text[i]); i++) {
			const c = text[i];
			if (c === "\\" && PUNCT.test(text[i + 1] ?? "")) {
				dest += text[++i];
				continue;
			}
			if (c === "(") depth++;
			else if (c === ")" && depth-- === 0) break;
			dest += c;
		}
		if (depth > 0) return null;
	}
	const afterDest = i;
	skipSpace();
	const open = text[i];
	if (i > afterDest && (open === '"' || open === "'" || open === "(")) {
		const close = open === "(" ? ")" : open;
		for (i++; text[i] !== close; i++) {
			if (text[i] === undefined || text[i] === "\n" || (open === "(" && text[i] === "(")) return null;
			if (text[i] === "\\") i++;
		}
		i++;
		skipSpace();
	}
	return text[i] === ")" ? { dest, end: i + 1 } : null;
}

/** Replace the contents of fenced code blocks and inline code with spaces, keeping offsets. */
function maskCode(text: string): string {
	const blank = (s: string) => s.replace(/[^\n]/g, " ");
	return text
		.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))/gm, blank)
		.replace(/(`+)[^`\n][\s\S]*?\1/g, (m) => (m.includes("\n\n") ? m : blank(m)));
}

function splitSubpath(path: string): { target: string; subpath: string } {
	const i = path.indexOf("#");
	return i === -1 ? { target: path, subpath: "" } : { target: path.slice(0, i), subpath: path.slice(i) };
}

/** Internal links in the text, in order. External URLs are left out. */
export function findLinks(text: string): FoundLink[] {
	const masked = maskCode(text);
	const out: FoundLink[] = [];
	for (const m of masked.matchAll(WIKI)) {
		const start = m.index ?? 0;
		const original = text.slice(start, start + m[0].length);
		const inner = original.slice(m[1].length + 2, -2);
		const bar = inner.indexOf("|");
		let path = bar === -1 ? inner : inner.slice(0, bar);
		let display = bar === -1 ? "" : inner.slice(bar);
		// In a table the alias bar is escaped: [[note\|alias]].
		if (bar !== -1 && path.endsWith("\\")) {
			path = path.slice(0, -1);
			display = "\\" + display;
		}
		const { target, subpath } = splitSubpath(path);
		out.push({ start, end: start + original.length, original, kind: "wiki", embed: !!m[1], target: target.trim(), subpath, display });
	}
	let lastEnd = 0;
	for (const m of masked.matchAll(MARKDOWN)) {
		const start = m.index ?? 0;
		// Inside a wikilink's alias ("[[a|[b](c)]]") or an earlier link's title is not a link of its own.
		if (start < lastEnd || out.some((w) => start >= w.start && start < w.end)) continue;
		const parsed = parseDestination(masked, start + m[0].length);
		if (!parsed) continue;
		lastEnd = parsed.end;
		const original = text.slice(start, parsed.end);
		const dest = parsed.dest;
		if (!dest || /^[a-z][a-z0-9+.-]*:/i.test(dest)) continue;
		let decoded = dest;
		try {
			decoded = decodeURI(dest);
		} catch {
			/* keep as written */
		}
		const { target, subpath } = splitSubpath(decoded);
		if (!target) continue;
		out.push({ start, end: start + original.length, original, kind: "markdown", embed: !!m[1], target, subpath, display: m[2] });
	}
	return out.sort((a, b) => a.start - b.start);
}

/**
 * The link rewritten to a new link path (as fileToLinktext gives it), keeping its subpath,
 * alias or text, and whether it embeds. A Markdown link keeps a ".md" ending if it had one.
 */
export function retarget(link: FoundLink, linktext: string): string {
	const bang = link.embed ? "!" : "";
	if (link.kind === "wiki") return `${bang}[[${linktext}${link.subpath}${link.display}]]`;
	const withExt = /\.md$/i.test(link.target) && !/\.md$/i.test(linktext) ? `${linktext}.md` : linktext;
	const dest = encodeURI(withExt).replace(/\(/g, "%28").replace(/\)/g, "%29") + link.subpath.replace(/ /g, "%20");
	return `${bang}[${link.display}](${dest})`;
}

/**
 * Rewrite every link in the text that `points` says goes to the old note, with `linktext`
 * for the new one. Returns the new text and how many links changed.
 */
export function rewriteLinks(text: string, points: (link: FoundLink) => boolean, linktext: string): { text: string; count: number } {
	const links = findLinks(text).filter(points);
	let out = text;
	for (const l of [...links].reverse()) out = out.slice(0, l.start) + retarget(l, linktext) + out.slice(l.end);
	return { text: out, count: links.length };
}
