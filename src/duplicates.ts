/**
 * Pure module: find duplicate reference notes by exact matches, and work out what merging
 * one into another changes. Nothing here is fuzzy: two notes match only on the same DOI,
 * ISBN or URL, or on the same title (ignoring case, accents and punctuation) and year.
 */
import { applyAnnotationBlock, currentAnnotationBlock, END_MARKER, START_MARKER } from "./annotations";
import { canonicalIsbn, normalizeDoi } from "./identifiers";
import { PropertyKey } from "./properties";
import { asText } from "./text";

type Fm = Record<string, unknown>;

export interface DupNote {
	path: string;
	basename: string;
	frontmatter: Fm;
}

export interface DupOptions {
	properties: Record<PropertyKey, string>;
	/** Extra properties a URL is read from (a clip's "source"). */
	urlProperties: string[];
}

export type MatchKind = "doi" | "isbn" | "url" | "title-year";

export interface MatchReason {
	kind: MatchKind;
	/** The shared value, as normalized for the comparison. */
	value: string;
}

export interface DuplicatePair {
	a: string;
	b: string;
	reasons: MatchReason[];
}

export interface DuplicateGroup {
	/** Paths of the notes, sorted. */
	paths: string[];
	/** Every matching pair in the group, with why it matched. */
	pairs: DuplicatePair[];
}

const isEmpty = (v: unknown) =>
	v === undefined || v === null || v === "" || (Array.isArray(v) && v.filter((x) => x !== null && x !== "").length === 0);

const first = (v: unknown): string => (Array.isArray(v) ? asText(v[0]) : asText(v)).trim();

/** Title for comparison: no accents, lower case, punctuation and spacing collapsed. */
export function normalizeTitle(title: string): string {
	return title
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/** A URL for comparison: scheme and host in lower case, default port and trailing slash dropped. */
export function normalizeUrl(raw: string): string | undefined {
	const s = raw.trim();
	if (!/^https?:\/\//i.test(s)) return undefined;
	try {
		const u = new URL(s);
		return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}${u.hash}`;
	} catch {
		return s.replace(/\/+$/, "");
	}
}

/** The keys a note is matched on. */
export function matchKeys(fm: Fm, o: DupOptions): MatchReason[] {
	const p = o.properties;
	const out: MatchReason[] = [];
	const doi = normalizeDoi(first(fm[p.doi]));
	if (doi) out.push({ kind: "doi", value: doi.toLowerCase() });
	const isbn = canonicalIsbn(first(fm[p.isbn]));
	if (isbn) out.push({ kind: "isbn", value: isbn });
	const urls = new Set<string>();
	for (const k of [p.url, ...o.urlProperties]) {
		const v = fm[k];
		for (const u of Array.isArray(v) ? v : [v]) {
			const n = normalizeUrl(asText(u));
			if (n) urls.add(n);
		}
	}
	for (const u of urls) out.push({ kind: "url", value: u });
	const title = normalizeTitle(first(fm[p.title]));
	const year = (first(fm[p.year]) || first(fm[p.published])).match(/\d{4}/)?.[0];
	if (title && year) out.push({ kind: "title-year", value: `${title} (${year})` });
	return out;
}

/** Why two notes matched, in words. */
export function describeReason(r: MatchReason): string {
	switch (r.kind) {
		case "doi":
			return `same DOI ${r.value}`;
		case "isbn":
			return `same ISBN ${r.value}`;
		case "url":
			return `same URL ${r.value}`;
		default:
			return `same title and year: ${r.value}`;
	}
}

/** Groups of notes that share a DOI, ISBN, URL, or title and year. Deterministic order. */
export function findDuplicates(notes: DupNote[], o: DupOptions): DuplicateGroup[] {
	const byKey = new Map<string, string[]>();
	const reasonOf = new Map<string, MatchReason>();
	for (const n of notes) {
		for (const r of matchKeys(n.frontmatter, o)) {
			const k = `${r.kind}\u0000${r.value}`;
			reasonOf.set(k, r);
			const list = byKey.get(k) ?? [];
			if (!list.includes(n.path)) list.push(n.path);
			byKey.set(k, list);
		}
	}
	const pairs = new Map<string, DuplicatePair>();
	const parent = new Map<string, string>();
	const root = (x: string): string => {
		let r = x;
		while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r) as string;
		parent.set(x, r);
		return r;
	};
	for (const [k, paths] of byKey) {
		if (paths.length < 2) continue;
		const sorted = [...paths].sort();
		for (let i = 0; i < sorted.length; i++)
			for (let j = i + 1; j < sorted.length; j++) {
				const id = `${sorted[i]}\u0000${sorted[j]}`;
				const pair = pairs.get(id) ?? { a: sorted[i], b: sorted[j], reasons: [] };
				pair.reasons.push(reasonOf.get(k) as MatchReason);
				pairs.set(id, pair);
				const ra = root(sorted[i]);
				const rb = root(sorted[j]);
				if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
			}
	}
	const groups = new Map<string, DuplicateGroup>();
	for (const pair of [...pairs.values()].sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1))) {
		const r = root(pair.a);
		const g = groups.get(r) ?? { paths: [], pairs: [] };
		for (const p of [pair.a, pair.b]) if (!g.paths.includes(p)) g.paths.push(p);
		pair.reasons.sort((x, y) => (x.kind + x.value < y.kind + y.value ? -1 : 1));
		g.pairs.push(pair);
		groups.set(r, g);
	}
	return [...groups.values()].map((g) => ({ ...g, paths: g.paths.sort() })).sort((x, y) => (x.paths[0] < y.paths[0] ? -1 : 1));
}

/**
 * The note to keep by default: the only one whose filename is its own citekey. Undefined
 * when none or several are, so the person chooses.
 */
export function preferredKeeper(notes: DupNote[], citekeyProperty: string): string | undefined {
	const canonical = notes.filter((n) => {
		const key = first(n.frontmatter[citekeyProperty]);
		return !!key && key === n.basename;
	});
	return canonical.length === 1 ? canonical[0].path : undefined;
}

// ---------------------------------------------------------------- merging properties

export interface PropertyChange {
	property: string;
	/** "fill": the kept note had no value. "union": list items added. */
	kind: "fill" | "union";
	/** The value written (fill) or the items added (union). */
	added: unknown;
}

export interface MergeOptions {
	/** List properties whose items are combined (collections, tags, attachments, aliases). */
	listProperties: string[];
	/** Properties never copied from the other note (its citekey). */
	skip: string[];
}

/** A list item for comparison: links lose brackets and alias, case ignored. */
const itemKey = (v: unknown) =>
	asText(v)
		.trim()
		.replace(/^\[\[([^\]|]*)(?:\|[^\]]*)?\]\]$/, "$1")
		.replace(/^#/, "")
		.toLowerCase();

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : isEmpty(v) ? [] : [v]);

/**
 * What merging `drop`'s properties into `keep` changes: list properties gain the items they
 * lack, and every empty property of `keep` takes `drop`'s value. Nothing `keep` already has
 * is replaced. Returns the new values to write and the changes for a preview.
 */
export function mergeFrontmatter(keep: Fm, drop: Fm, o: MergeOptions): { updates: Fm; changes: PropertyChange[] } {
	const updates: Fm = {};
	const changes: PropertyChange[] = [];
	for (const [k, v] of Object.entries(drop)) {
		if (k === "position" || o.skip.includes(k) || isEmpty(v)) continue;
		if (o.listProperties.includes(k)) {
			const current = asList(keep[k]);
			const have = new Set(current.map(itemKey));
			const add = asList(v).filter((x) => {
				const key = itemKey(x);
				if (!key || have.has(key)) return false;
				have.add(key);
				return true;
			});
			if (!add.length) continue;
			updates[k] = [...current, ...add];
			changes.push({ property: k, kind: "union", added: add });
		} else if (isEmpty(keep[k])) {
			updates[k] = v;
			changes.push({ property: k, kind: "fill", added: v });
		}
	}
	return { updates, changes };
}

// ---------------------------------------------------------------- merging bodies

/** The closing fence must start a line, so "a: b---" inside a value doesn't end it. */
const FRONTMATTER = /^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** A note's text split into its frontmatter (with the fences) and its body. */
export function splitNote(text: string): { frontmatter: string; body: string } {
	const m = text.match(FRONTMATTER);
	return m ? { frontmatter: m[0], body: text.slice(m[0].length) } : { frontmatter: "", body: text };
}

const paragraphs = (s: string) =>
	s
		.split(/\r?\n[ \t]*\r?\n/)
		.map((p) => p.replace(/^\s*\n|\s+$/g, ""))
		.filter((p) => p.trim());
const norm = (p: string) => p.replace(/\s+/g, " ").trim();
/** The annotation markers as paragraph breaks, so they never join the text beside them. */
const withoutMarkers = (s: string) => s.split(START_MARKER).join("\n\n").split(END_MARKER).join("\n\n");
const isHeading = (p: string) => /^#{1,6}\s/.test(p) && !p.includes("\n");

export interface BodyMerge {
	body: string;
	/** The other note's annotations block went into the kept note's empty one. */
	annotationsCopied: boolean;
	/** Paragraphs (prose, callouts) added under the "Merged from" heading. */
	paragraphsAdded: number;
}

/**
 * The kept note's body with what only the other note has: its annotations block when the
 * kept note's is missing or empty, then every paragraph the kept note lacks, under a
 * "Merged from …" heading at the end (outside the annotation markers, so re-extracting
 * never removes it). The section heading a paragraph sat under comes along with it.
 */
export function mergeBody(keepBody: string, dropBody: string, o: { dropName: string; annotationsHeading: string }): BodyMerge {
	let body = keepBody;
	let annotationsCopied = false;
	const dropBlock = currentAnnotationBlock(dropBody);
	const keepBlock = currentAnnotationBlock(keepBody);
	if (dropBlock && !keepBlock) {
		body = applyAnnotationBlock(body, dropBlock, o.annotationsHeading);
		annotationsCopied = true;
	}
	const have = new Set(paragraphs(withoutMarkers(body)).map(norm));
	const added: string[] = [];
	let heading: string | undefined;
	for (const p of paragraphs(withoutMarkers(dropBody))) {
		if (isHeading(p)) {
			// A top-level heading is the note's title, not a section.
			heading = /^#\s/.test(p) ? undefined : p;
			continue;
		}
		if (have.has(norm(p))) continue;
		// Headings sit below the "Merged from" heading.
		if (heading) added.push(heading.replace(/^#{1,2}\s+/, "### "));
		heading = undefined;
		added.push(p);
		have.add(norm(p));
	}
	const paragraphsAdded = added.filter((p) => !isHeading(p)).length;
	if (added.length) {
		const sep = body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : body ? "\n\n" : "";
		body = `${body}${sep}## Merged from ${o.dropName}\n\n${added.join("\n\n")}\n`;
	}
	return { body, annotationsCopied, paragraphsAdded };
}
