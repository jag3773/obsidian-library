/**
 * Pure module: RIS files (EndNote, Mendeley, Zotero, databases) as import records (#17).
 * docs/importing.md lists what is read.
 *
 * A record runs from "TY  - " to "ER  - ". Each line is a two-character tag, two spaces, a
 * hyphen and the value; tags such as AU, KW and L1 repeat. Lines without a tag continue the
 * previous value. Writers differ on spacing, so one space either side of the hyphen is
 * accepted too.
 */
import { canonicalIsbn, normalizeDoi } from "../identifiers";
import { parseDate, yearOf } from "../metadata/dates";
import { ReferenceData } from "../metadata/types";
import { PersonName, displayName, familyOf, parseName } from "../names";
import { Diagnostic, ImportRecord, ParseResult } from "./record";

/** RIS reference types as the plugin's types. */
export const RIS_TO_TYPE: Record<string, string> = {
	JOUR: "article",
	JFULL: "article",
	EJOUR: "article",
	MGZN: "article",
	NEWS: "article",
	BLOG: "article",
	INPR: "article",
	BOOK: "book",
	EBOOK: "book",
	EDBOOK: "book",
	CHAP: "chapter",
	ECHAP: "chapter",
	CONF: "paper",
	CPAPER: "paper",
	RPRT: "report",
	GOVDOC: "report",
	THES: "thesis",
	ELEC: "webpage",
	WEB: "webpage",
	COMP: "software",
	VIDEO: "video",
	MPCT: "video",
	SOUND: "audio",
	MUSIC: "audio",
	ENCYC: "reference",
	DICT: "reference",
	ART: "image",
	MAP: "image",
	FIGURE: "image",
	SLIDE: "presentation",
	GEN: "document",
	MANSCPT: "document",
	UNPB: "document",
	PCOMM: "document",
	ICOMM: "document",
	CASE: "document",
	STAT: "document",
	BILL: "document",
	PAT: "document",
	STAND: "document",
	DATA: "document",
	PAMP: "document",
	CTLG: "document",
	HEAR: "document",
	LEGAL: "document",
	ADVS: "video",
	AGGR: "document",
	ANCIENT: "document",
	CLSWK: "book",
	SER: "book",
	ABST: "article",
};

/** Tags the import reads, and ones that are bookkeeping rather than metadata. */
const MAPPED = new Set([
	"TY", "ER", "ID", "TI", "T1", "CT", "BT", "T2", "JO", "JF", "JA", "J1", "J2", "T3", "AU", "A1", "A2", "ED", "A3", "A4", "PY", "Y1", "DA", "Y2",
	"PB", "CY", "PP", "VL", "IS", "SP", "EP", "ET", "SN", "DO", "UR", "L1", "L2", "L4", "LA", "AB", "N2", "KW", "N1",
]);
const BOOKKEEPING = new Set(["DB", "DP", "AN", "C1", "ST"]);

export interface RisRecord {
	/** Tag → values in order. */
	tags: Record<string, string[]>;
	line: number;
}

const TAG = /^([A-Z][A-Z0-9])\s{1,2}-(?: (.*)|\s*)$/;

/** Split RIS text into records. Lines outside a record and records without an end are reported. */
export function parseRisRecords(text: string): { records: RisRecord[]; diagnostics: Diagnostic[] } {
	const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
	const records: RisRecord[] = [];
	const diagnostics: Diagnostic[] = [];
	let cur: RisRecord | null = null;
	let lastTag = "";
	let stray = 0;
	lines.forEach((raw, n) => {
		const line = raw.replace(/\s+$/, "");
		if (!line.trim()) return;
		const m = line.match(TAG);
		if (!m) {
			// A continuation of the previous value.
			if (cur && lastTag) {
				const list = cur.tags[lastTag];
				const sep = lastTag === "AB" || lastTag === "N1" || lastTag === "N2" ? "\n" : " ";
				list[list.length - 1] = `${list[list.length - 1]}${sep}${line.trim()}`;
			} else stray++;
			return;
		}
		const tag = m[1];
		const value = (m[2] ?? "").trim();
		if (tag === "TY") {
			if (cur) {
				diagnostics.push({ record: `line ${cur.line}`, problem: "the record has no ER line; it ends where the next one starts" });
				records.push(cur);
			}
			cur = { tags: { TY: [value] }, line: n + 1 };
			lastTag = "TY";
			return;
		}
		if (!cur) {
			stray++;
			return;
		}
		if (tag === "ER") {
			records.push(cur);
			cur = null;
			lastTag = "";
			return;
		}
		(cur.tags[tag] ??= []).push(value);
		lastTag = tag;
	});
	if (cur) {
		diagnostics.push({ record: `line ${(cur as RisRecord).line}`, problem: "the record has no ER line at the end of the file" });
		records.push(cur);
	}
	if (stray) diagnostics.push({ record: "file", problem: `${stray} line${stray === 1 ? "" : "s"} outside any record ignored` });
	return { records, diagnostics };
}

/** A RIS date ("2021/05/04/", "2021///", "2021-05-04", "2021/05/04/Spring") as ISO. */
export function risDate(v: string | undefined): string | undefined {
	if (!v) return undefined;
	const m = v.match(/^(\d{4})(?:[/-](\d{1,2})?(?:[/-](\d{1,2})?)?)?/);
	if (!m) return parseDate(v);
	const pad = (s: string) => s.padStart(2, "0");
	return parseDate(m[2] ? (m[3] ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : `${m[1]}-${pad(m[2])}`) : m[1]);
}

/** A RIS name: "Last, First" or "Last, First, Suffix"; "First Last" and organizations as names.ts reads them. */
export function risName(v: string): PersonName | undefined {
	const n = parseName(v);
	return n.literal || n.family || n.given ? n : undefined;
}

/** One RIS record as an import record. */
export function risToRecord(r: RisRecord, index: number, diagnostics: Diagnostic[]): ImportRecord {
	const all = (...tags: string[]) => tags.flatMap((t) => r.tags[t] ?? []).map((v) => v.trim()).filter(Boolean);
	const one = (...tags: string[]) => all(...tags)[0];
	const id = one("ID");
	// A bare number is a database's record number, not a citekey.
	const citekey = id && !/^\d+$/.test(id) && !/\s/.test(id) ? id : undefined;
	const label = citekey ?? `record ${index} (line ${r.line})`;
	const problem = (p: string) => diagnostics.push({ record: label, problem: p });
	if (id && !citekey) problem(`ID "${id}" isn't a citekey; one is made from the pattern in settings`);
	const risType = (one("TY") ?? "").toUpperCase();
	let type = RIS_TO_TYPE[risType];
	if (!type) {
		problem(risType ? `type ${risType} imported as a document` : "no type; imported as a document");
		type = "document";
	}
	const names = (...tags: string[]) => all(...tags).map(risName).filter((n): n is PersonName => !!n);
	const authors = names("AU", "A1");
	// In RIS, A2 is the editor of a book or chapter, and for a journal article the journal's.
	const editors = names("A2", "ED");
	const translators = names("A4");
	const contributors = names("A3");
	const title = one("TI", "T1", "CT") ?? (type === "book" ? one("BT") : undefined) ?? "";
	if (!title) problem("no title");
	const container = one("T2", "JF", "JO", "BT", "J1", "JA", "J2");
	// DA is the full date when a writer (Zotero) puts only the year in PY.
	const da = risDate(one("DA"));
	const py = risDate(one("PY", "Y1"));
	const date = da && (!py || (da.startsWith(py.slice(0, 4)) && da.length >= py.length)) ? da : py ?? da;
	if (one("PY", "Y1", "DA") && !date) problem(`date "${one("PY", "Y1", "DA")}" can't be read`);
	const sp = one("SP");
	const ep = one("EP");
	let isbn: string | undefined;
	let issn: string | undefined;
	for (const sn of all("SN")) {
		for (const part of sn.split(/[\s,;]+/)) {
			const asIsbn = canonicalIsbn(part);
			if (asIsbn && !isbn) isbn = asIsbn;
			else if (!asIsbn && /^\d{4}-?\d{3}[\dXx]$/.test(part) && !issn) issn = part.toUpperCase();
		}
	}
	const doi = one("DO");
	const urls = all("UR");
	const list = (n: PersonName[]) => (n.length ? n.map(displayName) : undefined);
	const data: ReferenceData = {
		type,
		title,
		authors: authors.map(displayName),
		familyNames: (authors.length ? authors : editors).map(familyOf),
		editors: list(editors),
		translators: list(translators),
		contributors: list(contributors),
		names: { authors, editors, translators, contributors },
		date,
		year: yearOf(date),
		publisher: one("PB"),
		place: one("CY", "PP"),
		journal: type === "book" && !one("T2", "JF", "JO") ? undefined : container,
		volume: one("VL"),
		issue: one("IS"),
		pages: sp && ep && ep !== sp ? `${sp}-${ep}` : sp,
		edition: one("ET"),
		series: one("T3"),
		language: one("LA"),
		isbn,
		issn,
		doi: doi ? normalizeDoi(doi) ?? undefined : undefined,
		url: urls.find((u) => /^https?:\/\//i.test(u)) ?? urls[0],
		accessed: risDate(one("Y2")),
		abstract: one("AB", "N2"),
		source: "RIS",
	};
	for (const k of Object.keys(data) as (keyof ReferenceData)[]) if (data[k] === undefined) delete data[k];
	if (doi && !data.doi) problem(`DO "${doi}" isn't a DOI`);
	for (const sn of all("SN")) if (!sn.split(/[\s,;]+/).some((p) => canonicalIsbn(p) || /^\d{4}-?\d{3}[\dXx]$/.test(p))) problem(`SN "${sn}" isn't an ISBN or ISSN`);
	return {
		label,
		citekey,
		sourceType: risType || "(none)",
		data,
		tags: all("KW").flatMap((k) => k.split(/\s*;\s*/)).filter(Boolean).map((tag) => ({ tag })),
		collections: [],
		// L1 is a file, L4 a figure; L2 links to full text (a URL, unless it names a file).
		attachments: [...all("L1", "L4"), ...all("L2").filter((l) => !/^https?:/i.test(l))],
		notes: all("N1"),
		unmapped: Object.keys(r.tags).filter((t) => !MAPPED.has(t) && !BOOKKEEPING.has(t) && all(t).length),
	};
}

/** Parse a RIS file. Records with problems are reported; duplicate IDs after the first are skipped. */
export function parseRis(text: string): ParseResult {
	const { records: raw, diagnostics } = parseRisRecords(text);
	const records: ImportRecord[] = [];
	const seen = new Set<string>();
	raw.forEach((r, i) => {
		const rec = risToRecord(r, i + 1, diagnostics);
		if (rec.citekey) {
			if (seen.has(rec.citekey.toLowerCase())) {
				diagnostics.push({ record: rec.label, problem: `ID used by an earlier record; the one on line ${r.line} is skipped` });
				return;
			}
			seen.add(rec.citekey.toLowerCase());
		}
		records.push(rec);
	});
	return { records, diagnostics };
}
