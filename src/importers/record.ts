/**
 * Pure module: the record every importer produces (#17, #18). A Zotero item, a CSL-JSON
 * item, a BibTeX entry or a RIS record becomes one ImportRecord; the planner in plan.ts
 * matches records to notes the same way whatever the file was.
 */
import { ReferenceData } from "../metadata/types";

export interface ImportRecord {
	/** How messages name the record: its citekey, or its position in the file. */
	label: string;
	/** The key the file supplies (CSL `id`, BibTeX entry key, RIS `ID`, Better BibTeX's citekey). */
	citekey?: string;
	/** A Zotero item key: matches zotero://select links in notes. */
	zoteroKey?: string;
	/** The record's type as the file writes it ("journalArticle", "article-journal", "inproceedings", "JOUR"). */
	sourceType: string;
	data: ReferenceData;
	/** Tags as written; `automatic` ones came from catalogs and feeds (Zotero). */
	tags: { tag: string; automatic?: boolean }[];
	/** Collection names the record is in (Zotero). */
	collections: string[];
	/** File paths or links to attachments, as the file gives them. Never copied, only looked up in the vault. */
	attachments: string[];
	/** ISO date the record was added to its library. */
	added?: string;
	/** Notes attached to the record (HTML or plain text); written only into notes the import creates. */
	notes: string[];
	/** Fields with a value that the import doesn't keep. */
	unmapped: string[];
}

/** Something wrong with one record, or with the file around it. */
export interface Diagnostic {
	/** The record's key or position ("line 12"). */
	record: string;
	problem: string;
}

export interface ParseResult {
	records: ImportRecord[];
	diagnostics: Diagnostic[];
}

/** Split a keyword list ("a, b; c") into tags. */
export function splitKeywords(s: string | undefined): string[] {
	if (!s) return [];
	const sep = s.includes(";") ? /\s*;\s*/ : /\s*,\s*/;
	return [...new Set(s.split(sep).map((t) => t.trim()).filter(Boolean))];
}

/** A non-empty trimmed string, or undefined; numbers become strings. */
export const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined);
