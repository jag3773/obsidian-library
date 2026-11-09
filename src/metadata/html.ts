/**
 * HTML helpers built on DOMParser. A parsed document is inert: scripts don't run and
 * images, styles and frames aren't loaded. Obsidian provides DOMParser; tests install linkedom's.
 */

export function parseHtml(html: string): Document {
	return new DOMParser().parseFromString(html, "text/html");
}

const BLOCKS = new Set(["P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "SECTION", "ARTICLE", "TR", "TABLE"]);

/**
 * Readable text of an element: <br> becomes a line break, block elements become paragraphs,
 * other whitespace collapses. Returns undefined when there is no text.
 */
export function blockText(el: Element | null | undefined): string | undefined {
	if (!el) return undefined;
	let out = "";
	const walk = (node: Node) => {
		for (const child of Array.from(node.childNodes)) {
			// Line breaks in the source are just whitespace in HTML.
			if (child.nodeType === 3) out += (child.textContent ?? "").replace(/\s+/g, " ");
			else if (child.nodeType === 1) {
				const tag = (child as Element).tagName.toUpperCase();
				if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") continue;
				if (tag === "BR") {
					out += "\n";
					continue;
				}
				const block = BLOCKS.has(tag);
				if (block) out += "\n\n";
				walk(child);
				if (block) out += "\n\n";
			}
		}
	};
	walk(el);
	return tidy(out);
}

/** Collapse spaces within lines and keep at most one blank line between paragraphs. */
export function tidy(s: string | undefined): string | undefined {
	if (!s) return undefined;
	const t = s
		.replace(/[‎‏ ]/g, " ")
		.split("\n")
		.map((line) => line.replace(/[ \t\r\f\v]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return t || undefined;
}

/** Text of an HTML fragment (a description that arrives as HTML in JSON). */
export function htmlToText(html: string | undefined): string | undefined {
	if (!html) return undefined;
	return blockText(parseHtml(`<!doctype html><html><head></head><body>${html}</body></html>`).body);
}

/** Single-line text content of the first element matching selector. */
export function text(root: ParentNode, selector: string): string | undefined {
	const t = root.querySelector(selector)?.textContent?.replace(/[\s‎‏]+/g, " ").trim();
	return t || undefined;
}
