/**
 * Reading an Obsidian Base (.base file) to learn which properties and folder a library uses.
 * Pure module: works on the parsed YAML, so it is unit tested without Obsidian.
 *
 * A base says which properties exist (its `properties`, view columns, groupings, sorts and
 * filters) and which folder it covers (`file.inFolder(...)`), but not what each property
 * means. matchProperties() bridges that by matching the plugin's fields to the base's
 * property names, by exact name first and then by common synonyms.
 */

import { PROPERTY_KEYS, PropertyKey } from "./properties";

/** The subset of a parsed .base file this module reads. Everything is optional and untrusted. */
export interface BaseConfig {
	filters?: unknown;
	properties?: Record<string, unknown>;
	views?: unknown[];
}

/** Turn a Bases property id into a note property name, or null for file./formula./this. ids. */
function noteProperty(id: unknown): string | null {
	if (typeof id !== "string") return null;
	const s = id.trim();
	if (!s || /^(file|formula|this)\./.test(s)) return null;
	return s.replace(/^note\./, "") || null;
}

/** Every filter expression string in a filter tree ({and|or|not: [...]}, or a string). */
function filterStrings(filter: unknown, out: string[] = []): string[] {
	if (typeof filter === "string") out.push(filter);
	else if (Array.isArray(filter)) for (const f of filter) filterStrings(f, out);
	else if (filter && typeof filter === "object") for (const v of Object.values(filter)) filterStrings(v, out);
	return out;
}

function allFilterStrings(config: BaseConfig): string[] {
	const out = filterStrings(config.filters);
	for (const v of config.views ?? []) if (v && typeof v === "object") filterStrings((v as { filters?: unknown }).filters, out);
	return out;
}

/** Note property names the base refers to, in first-seen order. */
export function basePropertyNames(config: BaseConfig): string[] {
	const ids: unknown[] = [];
	ids.push(...Object.keys(config.properties ?? {}));
	for (const raw of config.views ?? []) {
		if (!raw || typeof raw !== "object") continue;
		const v = raw as { order?: unknown; groupBy?: unknown; sort?: unknown };
		if (Array.isArray(v.order)) ids.push(...v.order);
		if (v.groupBy && typeof v.groupBy === "object") ids.push((v.groupBy as { property?: unknown }).property);
		if (Array.isArray(v.sort)) for (const s of v.sort) if (s && typeof s === "object") ids.push((s as { property?: unknown }).property);
	}
	for (const expr of allFilterStrings(config)) {
		for (const m of expr.matchAll(/\bnote\.([\p{L}\p{N}_-]+)/gu)) ids.push(m[1]);
		// Bracket form for names with spaces: note["Item Type"].
		for (const m of expr.matchAll(/\bnote\[\s*["']([^"']+)["']\s*\]/g)) ids.push(m[1]);
		for (const m of expr.matchAll(/hasProperty\(\s*["']([^"']+)["']\s*\)/g)) ids.push(m[1]);
		// Bare comparisons such as `status == "queued"`.
		for (const m of expr.matchAll(/(?:^|[\s(!&|])([\p{L}_][\p{L}\p{N}_-]*)\s*(?:==|!=|>=|<=|>|<)/gu)) ids.push(m[1]);
	}
	const seen = new Set<string>();
	const out: string[] = [];
	for (const id of ids) {
		const name = noteProperty(id);
		if (name && !seen.has(name)) {
			seen.add(name);
			out.push(name);
		}
	}
	return out;
}

/** Folders the base restricts itself to with file.inFolder("..."). */
export function baseFolders(config: BaseConfig): string[] {
	const out: string[] = [];
	for (const expr of filterStrings(config.filters)) {
		for (const m of expr.matchAll(/file\.inFolder\(\s*["']([^"']+)["']\s*\)/g)) if (!out.includes(m[1])) out.push(m[1]);
	}
	return out;
}

/** Other names a vault might use for each field, most likely first. */
export const SYNONYMS: Record<PropertyKey, string[]> = {
	citekey: ["citationKey", "citation-key", "citation_key", "key", "id"],
	type: ["itemType", "item-type", "kind", "category", "format"],
	title: ["name"],
	authors: ["author", "creators", "creator", "by"],
	year: ["date", "published", "publishDate", "publicationYear", "issued"],
	publisher: ["publishedBy"],
	// Not "source": Web Clipper uses that for the URL.
	journal: ["publication", "publicationTitle", "container", "containerTitle", "site", "siteName"],
	isbn: ["ISBN"],
	doi: ["DOI"],
	url: ["source", "link", "href", "website"],
	status: ["state", "reading", "readingStatus"],
	pdf: ["file", "pdfFile"],
	attachments: ["files", "attachment"],
	added: ["created", "dateAdded", "date-added", "added_on"],
};

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");

/**
 * Match each field to one of the available property names: exact name, then a synonym
 * (ignoring case, spaces, - and _). A name is used for at most one field. Fields with no
 * match keep the plugin's default name, which the plugin will create when it writes.
 */
export function matchProperties(available: string[]): Record<PropertyKey, string> {
	const byNorm = new Map<string, string>();
	for (const a of available) if (!byNorm.has(norm(a))) byNorm.set(norm(a), a);
	const used = new Set<string>();
	const out = {} as Record<PropertyKey, string>;
	const take = (candidate: string): string | undefined => {
		const hit = byNorm.get(norm(candidate));
		if (hit && !used.has(hit)) {
			used.add(hit);
			return hit;
		}
		return undefined;
	};
	// Exact names first for every field, so a synonym can't steal another field's own name
	// (e.g. url's synonym "source" when the vault also has a property literally named "url").
	for (const key of PROPERTY_KEYS) {
		const hit = take(key);
		if (hit) out[key] = hit;
	}
	for (const key of PROPERTY_KEYS) {
		if (out[key]) continue;
		for (const syn of SYNONYMS[key]) {
			const hit = take(syn);
			if (hit) {
				out[key] = hit;
				break;
			}
		}
		out[key] ??= key;
	}
	return out;
}

/** YAML for a starter library base over the references folder, using the mapped property names. */
export function starterBase(folder: string, p: Record<PropertyKey, string>): string {
	const q = (s: string) => JSON.stringify(s);
	return `filters:
  and:
    - file.inFolder(${q(folder)})
    - file.hasProperty(${q(p.citekey)})
formulas:
  name: file.asLink(note[${q(p.title)}])
properties:
  formula.name:
    displayName: Title
views:
  - type: table
    name: Library
    groupBy:
      property: note.${p.status}
      direction: ASC
    order:
      - formula.name
      - note.${p.authors}
      - note.${p.year}
      - note.${p.type}
      - note.${p.citekey}
  - type: table
    name: Queue
    filters: 'note[${q(p.status)}] == "queued"'
    order:
      - formula.name
      - note.${p.authors}
      - note.${p.year}
      - note.${p.added}
`;
}
