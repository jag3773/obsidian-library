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

/** Make a string safe for use as a file name on macOS, Windows and Linux. */
export function safeFilename(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 180);
}
