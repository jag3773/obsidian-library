/**
 * Minimal body template renderer. Pure module.
 *   {{name}}               value, or empty
 *   {{#name}}...{{/name}}  section rendered only when name has a value
 */

export type TemplateValues = Record<string, string | number | string[] | undefined | null>;

export const DEFAULT_TEMPLATE = `# {{title}}
{{#abstract}}
## Abstract
{{abstract}}
{{/abstract}}
## Annotations
`;

function str(v: TemplateValues[string]): string {
	if (v === undefined || v === null) return "";
	if (Array.isArray(v)) return v.join(", ");
	return String(v);
}

export function renderTemplate(template: string, values: TemplateValues): string {
	const withSections = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name: string, inner: string) =>
		str(values[name]).trim() ? inner : ""
	);
	return withSections.replace(/\{\{(\w+)\}\}/g, (_, name: string) => str(values[name]));
}

/**
 * Escape text that came from a remote source before it goes into a note body, so a
 * crafted title or abstract can't inject HTML, inline code (which plugins such as
 * Dataview may execute), remote images or links. Obsidian renders the escapes as the
 * plain characters.
 */
export function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_[\]<>!|$%#]/g, (c) => `\\${c}`).replace(/\r?\n/g, " ");
}

/**
 * An http(s) URL that is safe to insert into Markdown, both as plain text and as a
 * [text](destination) link: characters Markdown treats as syntax (backticks, brackets,
 * parentheses, emphasis, pipes, $ and so on) are percent-encoded. Servers treat the
 * encoded forms the same, so the link still goes to the same place.
 */
export function markdownSafeUrl(v: string | undefined): string | undefined {
	if (!v) return undefined;
	let u: URL;
	try {
		u = new URL(v);
	} catch {
		return undefined;
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
	// The authority can't be percent-encoded (IPv6 brackets are required syntax), so keep it
	// as is, but only for ordinary host names and IP literals: WHATWG URLs also accept
	// hosts containing backticks, parentheses and the like.
	if (!/^([a-z0-9_-]+\.)*[a-z0-9_-]+$|^\[[0-9a-f:.]+\]$/i.test(u.hostname)) return undefined;
	const rest = (u.pathname + u.search + u.hash)
		// A lone % (not an escape) could start an Obsidian %% comment.
		.replace(/%(?![0-9A-Fa-f]{2})/g, "%25")
		.replace(/[`()[\]<>!*_|$'"{}^\\~ ]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
	// origin also drops any user:password@ part.
	return u.origin + rest;
}

/**
 * Longest basename, in UTF-8 bytes, that safeFilename returns. Common filesystems allow
 * 255 bytes (or UTF-16 units) per path component; this leaves room for a collision
 * suffix such as " 12" and an extension such as ".md" or ".epub".
 */
export const MAX_FILENAME_BYTES = 200;

/** Device names Windows reserves regardless of extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** Make a string safe for use as a file name on macOS, Windows and Linux. */
export function safeFilename(name: string, maxBytes = MAX_FILENAME_BYTES): string {
	const cleaned = name
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		// Control characters (C0, DEL and C1).
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		// Leading dots hide the file.
		.replace(/^[.\s]+/, "");
	// Truncate by encoded length, whole code points at a time, so a surrogate pair is never split.
	let out = "";
	let bytes = 0;
	for (const ch of cleaned) {
		const n = utf8Length(ch);
		if (bytes + n > maxBytes) break;
		out += ch;
		bytes += n;
	}
	// Trailing dots and spaces are invalid on Windows.
	out = out.replace(/[.\s]+$/, "");
	// Windows treats NUL, NUL.tar and "NUL .tar.gz" all as the device NUL, so change the stem
	// (everything before the first dot), not the end of the name.
	const dot = out.indexOf(".");
	const stem = dot === -1 ? out : out.slice(0, dot);
	if (WINDOWS_RESERVED.test(stem.trimEnd())) out = `${stem.trimEnd()}_${out.slice(stem.length)}`;
	return out;
}
