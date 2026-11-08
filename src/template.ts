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

/** Make a string safe for use as a file name on macOS, Windows and Linux. */
export function safeFilename(name: string): string {
	const cleaned = name
		.replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	// Leading dots hide the file; trailing dots and spaces are invalid on Windows.
	// Slice by code point so a surrogate pair is never split.
	return Array.from(cleaned.replace(/^[.\s]+/, ""))
		.slice(0, 180)
		.join("")
		.replace(/[.\s]+$/, "");
}
