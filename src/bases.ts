/**
 * Reading an Obsidian Base (.base file) to learn which properties and folder a library uses.
 * Pure module: works on the parsed YAML, so it is unit tested without Obsidian.
 *
 * A base says which properties exist (its `properties`, formulas, view columns, groupings,
 * sorts and filters) and can require a folder (`file.inFolder(...)`), but doesn't say what
 * each property means. matchProperties() bridges that: display names first (a starter base
 * records each field there), then exact names, then common synonyms.
 */

import { DEFAULT_PROPERTY_NAMES, FIELD_LABELS, PROPERTY_KEYS, PropertyKey } from "./properties";

/** A parsed .base file, after validateBase() has accepted its shape. */
export interface BaseConfig {
	filters?: BaseFilter;
	properties?: Record<string, unknown>;
	formulas?: Record<string, unknown>;
	views?: BaseView[];
}
export type BaseFilter = string | { and: BaseFilter[] } | { or: BaseFilter[] } | { not: BaseFilter[] };
interface BaseView {
	filters?: BaseFilter;
	order?: string[];
	groupBy?: { property?: string };
	sort?: { property?: string }[];
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function filterError(f: unknown, where: string): string | null {
	if (typeof f === "string") return null;
	if (!isObject(f)) return `${where} must be an expression or an and/or/not list`;
	const keys = Object.keys(f);
	if (keys.length !== 1 || !["and", "or", "not"].includes(keys[0])) return `${where} must have exactly one of and, or, not`;
	const list = f[keys[0]];
	if (!Array.isArray(list)) return `${where}.${keys[0]} must be a list`;
	for (let i = 0; i < list.length; i++) {
		const e = filterError(list[i], `${where}.${keys[0]}[${i}]`);
		if (e) return e;
	}
	return null;
}

/**
 * Check that parsed YAML has the shape of a Base before anything reads it.
 * Returns a readable reason, or null when it is usable.
 */
export function validateBase(parsed: unknown): string | null {
	if (!isObject(parsed)) return "it isn't a Base (expected filters, properties or views)";
	if (parsed.filters !== undefined) {
		const e = filterError(parsed.filters, "filters");
		if (e) return e;
	}
	for (const k of ["properties", "formulas"]) if (parsed[k] !== undefined && !isObject(parsed[k])) return `${k} must be a mapping`;
	if (parsed.views === undefined) return null;
	if (!Array.isArray(parsed.views)) return "views must be a list";
	for (let i = 0; i < parsed.views.length; i++) {
		const v = parsed.views[i];
		const at = `views[${i}]`;
		if (!isObject(v)) return `${at} must be a mapping`;
		if (v.order !== undefined && (!Array.isArray(v.order) || v.order.some((o) => typeof o !== "string"))) return `${at}.order must be a list of property names`;
		if (v.groupBy !== undefined && !isObject(v.groupBy)) return `${at}.groupBy must be a mapping`;
		if (v.sort !== undefined && (!Array.isArray(v.sort) || v.sort.some((s) => !isObject(s)))) return `${at}.sort must be a list of mappings`;
		if (v.filters !== undefined) {
			const e = filterError(v.filters, `${at}.filters`);
			if (e) return e;
		}
	}
	return null;
}

// ---------------------------------------------------------------- expressions

/** A string literal in the Bases expression language, with backslash escapes. */
const STRING_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/y;

function unquote(literal: string): string {
	return literal.slice(1, -1).replace(/\\(.)/g, "$1");
}

/** Split an expression on a top-level operator (outside string literals and brackets). */
function splitTop(expr: string, op: "&&" | "||"): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < expr.length; ) {
		const c = expr[i];
		if (c === '"' || c === "'") {
			STRING_RE.lastIndex = i;
			const m = STRING_RE.exec(expr);
			i = m ? i + m[0].length : expr.length;
			continue;
		}
		if (c === "(" || c === "[") depth++;
		else if (c === ")" || c === "]") depth--;
		else if (depth === 0 && expr.startsWith(op, i)) {
			parts.push(expr.slice(start, i));
			start = i += op.length;
			continue;
		}
		i++;
	}
	parts.push(expr.slice(start));
	return parts.map((p) => p.trim());
}

/** Decoded string arguments of calls like name("literal") in an expression. */
function* stringCalls(expr: string, name: RegExp): Generator<string> {
	const re = new RegExp(`${name.source}\\(\\s*`, "g");
	for (let m = re.exec(expr); m; m = re.exec(expr)) {
		STRING_RE.lastIndex = re.lastIndex;
		const found = STRING_RE.exec(expr);
		if (found) yield unquote(found[0]);
	}
}

/** Decoded keys of note["..."] lookups. */
function* bracketKeys(expr: string): Generator<string> {
	const re = /\bnote\[\s*/g;
	for (let m = re.exec(expr); m; m = re.exec(expr)) {
		STRING_RE.lastIndex = re.lastIndex;
		const found = STRING_RE.exec(expr);
		if (found) yield unquote(found[0]);
	}
}

/** The folder an expression requires if it is exactly file.inFolder("...") (optionally parenthesized). */
function inFolderOnly(expr: string): string | null {
	let e = expr.trim();
	while (e.startsWith("(") && e.endsWith(")")) e = e.slice(1, -1).trim();
	const m = /^file\.inFolder\(\s*/.exec(e);
	if (!m) return null;
	STRING_RE.lastIndex = m[0].length;
	const found = STRING_RE.exec(e);
	if (!found) return null;
	return /^\s*\)$/.test(e.slice(m[0].length + found[0].length)) ? unquote(found[0]) : null;
}

/** Folders a filter requires every row to be in. Negations and alternatives require nothing. */
function requiredIn(filter: BaseFilter | undefined): string[] {
	if (filter === undefined) return [];
	if (typeof filter === "string") {
		if (splitTop(filter, "||").length > 1) return [];
		return splitTop(filter, "&&").map(inFolderOnly).filter((f): f is string => f !== null);
	}
	if ("and" in filter) return filter.and.flatMap(requiredIn);
	if ("or" in filter) {
		// Required only if every alternative requires it.
		const sets = filter.or.map(requiredIn);
		return sets.length ? sets[0].filter((f) => sets.every((s) => s.includes(f))) : [];
	}
	return [];
}

const cleanFolder = (f: string) => f.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");

/**
 * The one folder the base requires (from its top-level filters), or null when it doesn't
 * require exactly one. Nested requirements (A and A/B) resolve to the deepest.
 */
export function baseFolder(config: BaseConfig): string | null {
	const req = [...new Set(requiredIn(config.filters).map(cleanFolder).filter(Boolean))];
	if (!req.length) return null;
	const deepest = req.reduce((a, b) => (b.length > a.length ? b : a));
	return req.every((f) => deepest === f || deepest.startsWith(f + "/")) ? deepest : null;
}

// ---------------------------------------------------------------- properties

/** Turn a Bases property id into a note property name, or null for file./formula./this. ids. */
function noteProperty(id: unknown): string | null {
	if (typeof id !== "string") return null;
	const s = id.trim();
	if (!s || /^(file|formula|this)\./.test(s)) return null;
	return s.replace(/^note\./, "") || null;
}

function filterStrings(filter: BaseFilter | undefined, out: string[] = []): string[] {
	if (filter === undefined) return out;
	if (typeof filter === "string") out.push(filter);
	else for (const list of Object.values(filter) as BaseFilter[][]) for (const f of list) filterStrings(f, out);
	return out;
}

/** Note properties an expression reads: note.x, note["x y"], hasProperty("x"), bare `x == ...`. */
function expressionProperties(expr: string): string[] {
	const out: string[] = [];
	for (const m of expr.matchAll(/\bnote\.([\p{L}\p{N}_-]+)/gu)) out.push(m[1]);
	out.push(...bracketKeys(expr));
	out.push(...stringCalls(expr, /hasProperty/));
	for (const m of expr.matchAll(/(?:^|[\s(!&|])([\p{L}_][\p{L}\p{N}_-]*)\s*(?:==|!=|>=|<=|>|<)/gu)) out.push(m[1]);
	return out;
}

/** Note property names the base refers to, in first-seen order. Expects a validated config. */
export function basePropertyNames(config: BaseConfig): string[] {
	const ids: unknown[] = [...Object.keys(config.properties ?? {})];
	for (const v of config.views ?? []) {
		ids.push(...(v.order ?? []));
		ids.push(v.groupBy?.property);
		for (const s of v.sort ?? []) ids.push(s.property);
	}
	const exprs = [...filterStrings(config.filters)];
	for (const v of config.views ?? []) filterStrings(v.filters, exprs);
	for (const f of Object.values(config.formulas ?? {})) if (typeof f === "string") exprs.push(f);
	for (const e of exprs) ids.push(...expressionProperties(e));
	return [...new Set(ids.map(noteProperty).filter((n): n is string => !!n))];
}

/** Display names the base gives note properties ({property name: display name}). */
export function baseDisplayNames(config: BaseConfig): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [id, conf] of Object.entries(config.properties ?? {})) {
		const name = noteProperty(id);
		const display = isObject(conf) ? conf.displayName : undefined;
		if (name && typeof display === "string" && display.trim()) out[name] = display.trim();
	}
	return out;
}

/** Other names a vault might use for each field, most likely first. */
export const SYNONYMS: Record<PropertyKey, string[]> = {
	citekey: ["citationKey", "citation-key", "citation_key", "key", "id"],
	type: ["itemType", "item-type", "kind", "category", "format"],
	title: ["name"],
	authors: ["author", "creators", "creator", "by"],
	year: ["publicationYear", "yearPublished", "pubYear"],
	// Web Clipper writes the publication date as "published".
	published: ["date", "datePublished", "publishDate", "publicationDate", "pubDate", "issued", "releaseDate"],
	publisher: ["publishedBy"],
	// Not "source": Web Clipper uses that for the URL.
	journal: ["publication", "publicationTitle", "container", "containerTitle", "site", "siteName"],
	isbn: ["ISBN"],
	doi: ["DOI"],
	url: ["source", "link", "href", "website"],
	// Web Clipper writes the page summary as "description"; Zotero calls it abstractNote.
	abstract: ["description", "abstractNote", "summary", "synopsis"],
	status: ["state", "reading", "readingStatus"],
	pdf: ["file", "pdfFile"],
	attachments: ["files", "attachment"],
	added: ["created", "dateAdded", "date-added", "added_on"],
	highlights: ["annotations", "highlightCount", "annotationCount"],
	lastHighlighted: ["lastAnnotated", "last_annotated", "highlighted"],
};

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");

/**
 * Match each field to one of the available property names, using in order: a display name
 * equal to the field's label or key, the exact name, then a synonym (ignoring case, spaces,
 * - and _). A name is used for at most one field. Unmatched fields keep the default name.
 */
export function matchProperties(available: string[], displayNames: Record<string, string> = {}): Record<PropertyKey, string> {
	const byNorm = new Map<string, string>();
	for (const a of available) if (!byNorm.has(norm(a))) byNorm.set(norm(a), a);
	const used = new Set<string>();
	const out: Partial<Record<PropertyKey, string>> = {};
	const take = (name: string | undefined): string | undefined => {
		if (!name || used.has(name)) return undefined;
		used.add(name);
		return name;
	};
	for (const key of PROPERTY_KEYS) {
		const wanted = [norm(FIELD_LABELS[key]), norm(key)];
		const hit = Object.entries(displayNames).find(([name, display]) => available.includes(name) && !used.has(name) && wanted.includes(norm(display)));
		out[key] = take(hit?.[0]);
	}
	// Exact names before synonyms, so a synonym can't take another field's own name.
	for (const key of PROPERTY_KEYS) out[key] ??= take(byNorm.get(norm(key)));
	for (const key of PROPERTY_KEYS) {
		for (const syn of SYNONYMS[key]) out[key] ??= take(byNorm.get(norm(syn)));
		out[key] ??= DEFAULT_PROPERTY_NAMES[key];
	}
	return out as Record<PropertyKey, string>;
}

/** A Bases expression string literal. */
const lit = (s: string) => JSON.stringify(s);

/**
 * A starter library base over `folder`, as an object for a YAML serializer (so every
 * expression and property id is quoted correctly at the YAML layer). Every field is listed
 * under `properties` with its label as display name, so reading the base back recovers the
 * exact mapping it was made from.
 */
export function starterBase(folder: string, p: Record<PropertyKey, string>): Record<string, unknown> {
	const id = (k: PropertyKey) => `note.${p[k]}`;
	const properties: Record<string, unknown> = { "formula.name": { displayName: "Title" } };
	for (const k of PROPERTY_KEYS) properties[id(k)] = { displayName: FIELD_LABELS[k] };
	return {
		filters: { and: [`file.inFolder(${lit(folder)})`, `file.hasProperty(${lit(p.citekey)})`] },
		formulas: { name: `file.asLink(note[${lit(p.title)}])` },
		properties,
		views: [
			{
				type: "table",
				name: "Library",
				groupBy: { property: id("status"), direction: "ASC" },
				order: ["formula.name", id("authors"), id("year"), id("type"), id("citekey")],
			},
			{
				type: "table",
				name: "Queue",
				filters: `note[${lit(p.status)}] == "queued"`,
				order: ["formula.name", id("authors"), id("year"), id("added")],
			},
		],
	};
}
