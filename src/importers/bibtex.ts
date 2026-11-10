/**
 * Pure module: BibTeX and BibLaTeX files as import records (#17). The reverse of the
 * bibliography export in src/bibliography.ts; docs/importing.md lists what is read.
 *
 * The parser follows BibTeX's own rules: anything outside an entry is a comment; values are
 * {braced}, "quoted", numbers or @string macros joined with #; names are split on "and" at
 * brace level 0 into First von Last, von Last, First or von Last, Jr, First; braces protect a
 * name or word as written. LaTeX accents and common commands become Unicode.
 */
import { canonicalIsbn, normalizeDoi } from "../identifiers";
import { parseDate, yearOf } from "../metadata/dates";
import { ReferenceData, joinTitle } from "../metadata/types";
import { PersonName, displayName, familyOf } from "../names";
import { Diagnostic, ImportRecord, ParseResult, splitKeywords } from "./record";

/** BibTeX and BibLaTeX entry types as the plugin's types. */
export const BIB_TO_TYPE: Record<string, string> = {
	article: "article",
	book: "book",
	mvbook: "book",
	bookinbook: "book",
	collection: "book",
	mvcollection: "book",
	proceedings: "book",
	mvproceedings: "book",
	reference: "book",
	mvreference: "book",
	inbook: "chapter",
	incollection: "chapter",
	suppbook: "chapter",
	suppcollection: "chapter",
	inproceedings: "paper",
	conference: "paper",
	report: "report",
	techreport: "report",
	thesis: "thesis",
	phdthesis: "thesis",
	mastersthesis: "thesis",
	online: "webpage",
	electronic: "webpage",
	www: "webpage",
	software: "software",
	video: "video",
	movie: "video",
	audio: "audio",
	music: "audio",
	inreference: "reference",
	artwork: "image",
	image: "image",
	misc: "document",
	booklet: "document",
	manual: "document",
	unpublished: "document",
	letter: "document",
	dataset: "document",
	patent: "document",
	standard: "document",
	periodical: "document",
	suppperiodical: "document",
	legislation: "document",
	jurisdiction: "document",
	legal: "document",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Fields whose value is taken as written: no LaTeX decoding. */
const VERBATIM = new Set(["url", "doi", "file", "eprint", "pdf", "verba", "verbb", "verbc"]);

/** Fields the import reads, and ones that are bookkeeping rather than metadata. */
const MAPPED = new Set([
	"author", "editor", "translator", "title", "subtitle", "date", "year", "month", "journaltitle", "journal", "booktitle", "publisher", "institution",
	"school", "organization", "location", "address", "volume", "number", "issue", "pages", "edition", "series", "isbn", "issn", "doi", "url",
	"urldate", "langid", "language", "abstract", "keywords", "file", "note", "annote", "annotation", "timestamp", "creationdate", "date-added",
	"groups", "howpublished", "eprint", "eprinttype", "archiveprefix", "pdf",
]);
const BOOKKEEPING = new Set(["owner", "modificationdate", "date-modified", "bdsk-url-1", "bdsk-url-2", "bdsk-file-1", "bdsk-file-2", "crossref"]);

// LaTeX ------------------------------------------------------------------------------------

/** Accent commands as combining characters. */
const ACCENTS: Record<string, string> = {
	"'": "\u0301", "`": "\u0300", "^": "\u0302", '"': "\u0308", "~": "\u0303", "=": "\u0304", ".": "\u0307",
	u: "\u0306", v: "\u030C", H: "\u030B", c: "\u0327", k: "\u0328", r: "\u030A", d: "\u0323", b: "\u0331", t: "\u0361",
};

/** Commands that are a character. */
const SYMBOLS: Record<string, string> = {
	ss: "ß", SS: "SS", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", o: "ø", O: "Ø", l: "ł", L: "Ł", aa: "å", AA: "Å", i: "ı", j: "ȷ",
	dh: "ð", DH: "Ð", th: "þ", TH: "Þ", ng: "ŋ", NG: "Ŋ", dj: "đ", DJ: "Đ",
	textendash: "–", textemdash: "—", textquoteright: "’", textquoteleft: "‘", textquotedblleft: "“", textquotedblright: "”",
	textellipsis: "…", ldots: "…", dots: "…", textregistered: "®", texttrademark: "™", textcopyright: "©", copyright: "©",
	textdegree: "°", textsection: "§", S: "§", P: "¶", pounds: "£", euro: "€", texteuro: "€", textbackslash: "\\",
	textasciitilde: "~", textasciicircum: "^", textunderscore: "_", textbar: "|", textless: "<", textgreater: ">",
	guillemotleft: "«", guillemotright: "»", quad: " ", qquad: " ", LaTeX: "LaTeX", TeX: "TeX", BibTeX: "BibTeX",
	alpha: "α", beta: "β", gamma: "γ", delta: "δ", mu: "μ", pi: "π", sigma: "σ", lambda: "λ", omega: "ω",
	textalpha: "α", textbeta: "β", textmu: "μ", times: "×", pm: "±", leq: "≤", geq: "≥", infty: "∞",
};

/** Commands whose arguments are dropped with them. */
const DROP_ARGUMENT = new Set(["cite", "ref", "label", "footnote", "index"]);

/** LaTeX as plain Unicode text: accents and symbols converted, formatting and braces removed. */
export function decodeLatex(s: string): string {
	let i = 0;
	const group = (): string => {
		// At "{": the decoded content of the balanced group.
		let depth = 0;
		const start = i;
		for (; i < s.length; i++) {
			if (s[i] === "\\") i++;
			else if (s[i] === "{") depth++;
			else if (s[i] === "}" && --depth === 0) break;
		}
		const inner = s.slice(start + 1, i);
		i++;
		return decodeLatex(inner);
	};
	const skipSpace = () => {
		while (s[i] === " " || s[i] === "\t" || s[i] === "\n" || s[i] === "\r") i++;
	};
	const argument = (): string => {
		skipSpace();
		if (s[i] === "{") return group();
		if (s[i] === "\\") {
			// \'\i, \"\o
			const m = s.slice(i).match(/^\\([a-zA-Z]+)/);
			if (m) {
				i += m[0].length;
				return m[1] === "i" ? "i" : m[1] === "j" ? "j" : SYMBOLS[m[1]] ?? "";
			}
		}
		return s[i++] ?? "";
	};
	const accent = (mark: string) => {
		const arg = argument();
		const base = arg === "ı" ? "i" : arg === "ȷ" ? "j" : arg;
		return base ? base[0] + mark + base.slice(1) : "";
	};
	let out = "";
	while (i < s.length) {
		const c = s[i];
		if (c === "\\") {
			const next = s[i + 1] ?? "";
			if (/[a-zA-Z]/.test(next)) {
				const name = s.slice(i + 1).match(/^[a-zA-Z]+/)![0];
				i += 1 + name.length;
				if (name.length === 1 && ACCENTS[name] && name !== "i") {
					out += accent(ACCENTS[name]);
					continue;
				}
				if (name in SYMBOLS) {
					// A control word swallows the space after it; "{}" after it is just a separator.
					if (s.slice(i, i + 2) === "{}") i += 2;
					else if (s[i] === " ") i++;
					out += SYMBOLS[name];
					continue;
				}
				skipSpace();
				if (name === "href" && s[i] === "{") {
					group();
					skipSpace();
					out += s[i] === "{" ? group() : "";
					continue;
				}
				if (DROP_ARGUMENT.has(name)) {
					if (s[i] === "{") group();
					continue;
				}
				// \emph{x}, \textit{x}, \url{x}, \mkbibquote{x} and unknown commands: the argument stays.
				if (s[i] === "{") out += group();
				continue;
			}
			i += 2;
			if (ACCENTS[next]) out += accent(ACCENTS[next]);
			else if ("&%$#_{}".includes(next)) out += next;
			else if (next === "\\" || next === " " || next === ",") out += " ";
			// "\-" (a hyphenation point) and anything else unknown are dropped.
			continue;
		}
		if (c === "{" || c === "}" || c === "$") {
			i++;
			continue;
		}
		if (c === "~") {
			out += " ";
			i++;
			continue;
		}
		if (s.startsWith("---", i)) {
			out += "—";
			i += 3;
			continue;
		}
		if (s.startsWith("--", i)) {
			out += "–";
			i += 2;
			continue;
		}
		if (s.startsWith("``", i)) {
			out += "“";
			i += 2;
			continue;
		}
		if (s.startsWith("''", i)) {
			out += "”";
			i += 2;
			continue;
		}
		out += c;
		i++;
	}
	return out.normalize("NFC").replace(/\s+/g, " ").trim();
}

// Names ------------------------------------------------------------------------------------

/** Split at brace level 0 on a separator test, keeping braces in the pieces. */
function splitTop(s: string, isSep: (s: string, i: number) => number): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === "\\") {
			i++;
			continue;
		}
		if (c === "{") depth++;
		else if (c === "}") depth = Math.max(0, depth - 1);
		else if (depth === 0) {
			const len = isSep(s, i);
			if (len) {
				out.push(s.slice(start, i));
				start = i + len;
				i += len - 1;
			}
		}
	}
	out.push(s.slice(start));
	return out.map((x) => x.trim()).filter(Boolean);
}

const words = (s: string) => splitTop(s, (t, i) => (/[\s~]/.test(t[i]) ? 1 : 0));

/** True when a name word starts lower case at brace level 0 (a "von" part). A braced word is never one. */
function isLowerWord(w: string): boolean {
	if (w.startsWith("{") && !w.startsWith("{\\")) return false;
	const first = decodeLatex(w).match(/\p{L}/u)?.[0];
	return !!first && first === first.toLowerCase() && first !== first.toUpperCase();
}

const whole = (s: string) => {
	if (!s.startsWith("{") || !s.endsWith("}")) return false;
	let depth = 0;
	for (let i = 0; i < s.length; i++) {
		if (s[i] === "\\") i++;
		else if (s[i] === "{") depth++;
		else if (s[i] === "}" && --depth === 0 && i < s.length - 1) return false;
	}
	return true;
};

/** One BibTeX name as the plugin's name; undefined for "others" or an empty name. */
export function bibName(raw: string): PersonName | undefined {
	const s = raw.trim();
	if (!s || s.toLowerCase() === "others") return undefined;
	if (whole(s)) {
		const literal = decodeLatex(s);
		return literal ? { literal } : undefined;
	}
	const join = (ws: string[]) => decodeLatex(ws.join(" ")) || undefined;
	const parts = splitTop(s, (t, i) => (t[i] === "," ? 1 : 0));
	let first: string[] = [];
	let von: string[] = [];
	let last: string[] = [];
	let jr: string | undefined;
	if (parts.length === 1) {
		const w = words(parts[0]);
		if (w.length === 1) return { literal: decodeLatex(w[0]) };
		const lowers = w.map((x, i) => (i < w.length - 1 && isLowerWord(x) ? i : -1)).filter((i) => i >= 0);
		if (lowers.length) {
			first = w.slice(0, lowers[0]);
			von = w.slice(lowers[0], lowers[lowers.length - 1] + 1);
			last = w.slice(lowers[lowers.length - 1] + 1);
		} else {
			first = w.slice(0, -1);
			last = w.slice(-1);
		}
	} else {
		const w = words(parts[0]);
		let k = 0;
		while (k < w.length - 1 && isLowerWord(w[k])) k++;
		von = w.slice(0, k);
		last = w.slice(k);
		if (parts.length >= 3) jr = join(words(parts[1]));
		first = words(parts.slice(parts.length >= 3 ? 2 : 1).join(", "));
	}
	const family = join(last);
	if (!family) return join(first) ? { literal: join(first)! } : undefined;
	const out: PersonName = { family };
	const given = join(first);
	if (given) out.given = given;
	const particle = join(von);
	if (particle) out.particle = particle;
	if (jr) out.suffix = jr;
	return out;
}

/** A name list ("Doe, Jane and van Beethoven, Ludwig and others"). */
export function bibNames(raw: string | undefined): { names: PersonName[]; others: boolean } {
	if (!raw) return { names: [], others: false };
	const pieces = splitTop(raw, (t, i) => {
		const m = t.slice(i).match(/^\s+and\s+/i);
		return m && /\s/.test(t[i]) ? m[0].length : 0;
	});
	const names = pieces.map(bibName).filter((n): n is PersonName => !!n);
	return { names, others: pieces.some((p) => p.trim().toLowerCase() === "others") };
}

// Parser -----------------------------------------------------------------------------------

export interface BibEntry {
	type: string;
	key: string;
	/** Field values as written inside their delimiters, macros expanded, lower-case names. */
	fields: Record<string, string>;
	line: number;
}

class BibError extends Error {}

/** Split a .bib file into entries, expanding @string macros. Malformed entries are reported and skipped. */
export function parseBibEntries(text: string): { entries: BibEntry[]; diagnostics: Diagnostic[] } {
	const s = text.replace(/^\uFEFF/, "");
	const entries: BibEntry[] = [];
	const diagnostics: Diagnostic[] = [];
	const macros = new Map<string, string>(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map((m, i) => [m, MONTHS[i]]));
	// Line numbers, counted on from the last position asked about so a large file stays linear.
	let counted = 0;
	let countedLine = 1;
	const lineAt = (pos: number) => {
		if (pos < counted) {
			counted = 0;
			countedLine = 1;
		}
		for (; counted < pos; counted++) if (s.charCodeAt(counted) === 10) countedLine++;
		return countedLine;
	};
	let i = 0;

	const skipSpace = () => {
		while (i < s.length && /\s/.test(s[i])) i++;
	};
	const ENTRY_START = /^\n[ \t]*@[a-zA-Z]+[ \t]*[{(]/;
	/** A balanced {group} from "{"; returns its inside. */
	const braced = (): string => {
		const start = i;
		let depth = 0;
		for (; i < s.length; i++) {
			const c = s[i];
			if (c === "\\") i++;
			else if (c === "{") depth++;
			else if (c === "}" && --depth === 0) {
				i++;
				return s.slice(start + 1, i - 1);
			} else if (c === "\n" && ENTRY_START.test(s.slice(i, i + 40))) break;
		}
		throw new BibError(`a brace opened on line ${lineAt(start)} isn't closed`);
	};
	const quoted = (): string => {
		const start = i++;
		let depth = 0;
		for (; i < s.length; i++) {
			const c = s[i];
			if (c === "\\") i++;
			else if (c === "{") depth++;
			else if (c === "}") depth--;
			else if (c === '"' && depth <= 0) {
				i++;
				return s.slice(start + 1, i - 1);
			} else if (c === "\n" && ENTRY_START.test(s.slice(i, i + 40))) break;
		}
		throw new BibError(`a quote opened on line ${lineAt(start)} isn't closed`);
	};
	const value = (onMacro: (name: string) => void): string => {
		let out = "";
		for (;;) {
			skipSpace();
			const c = s[i];
			if (c === "{") out += braced();
			else if (c === '"') out += quoted();
			else {
				const m = s.slice(i).match(/^[^\s,#{}()"=]+/);
				if (!m) throw new BibError(`a value is missing on line ${lineAt(i)}`);
				i += m[0].length;
				const name = m[0].toLowerCase();
				if (/^\d+$/.test(m[0])) out += m[0];
				else if (macros.has(name)) out += macros.get(name);
				else {
					onMacro(m[0]);
					out += m[0];
				}
			}
			skipSpace();
			if (s[i] !== "#") return out;
			i++;
		}
	};

	while (i < s.length) {
		const at = s.indexOf("@", i);
		if (at < 0) break;
		i = at + 1;
		const head = s.slice(i).match(/^\s*([a-zA-Z]+)\s*([{(])/);
		if (!head) continue; // an "@" in a comment
		const type = head[1].toLowerCase();
		const close = head[2] === "{" ? "}" : ")";
		const startLine = lineAt(at);
		i += head[0].length;
		try {
			if (type === "comment" || type === "preamble") {
				i--;
				if (close === "}") braced();
				else {
					const end = s.indexOf(")", i);
					i = end < 0 ? s.length : end + 1;
				}
				continue;
			}
			if (type === "string") {
				skipSpace();
				const m = s.slice(i).match(/^([^\s=,{}()"#]+)\s*=/);
				if (!m) throw new BibError("a @string without a name");
				i += m[0].length;
				const v = value((name) => diagnostics.push({ record: `line ${startLine}`, problem: `@string uses an undefined macro "${name}"` }));
				macros.set(m[1].toLowerCase(), v);
				skipSpace();
				if (s[i] === close) i++;
				continue;
			}
			skipSpace();
			const keyStart = i;
			const keyMatch = s.slice(i).match(/^[^\s,{}()"=#]*/)!;
			let key = keyMatch[0];
			i += key.length;
			skipSpace();
			// "@article{title = ...": no key at all.
			if (s[i] === "=") {
				i = keyStart;
				key = "";
			} else if (s[i] === ",") i++;
			else if (s[i] !== close) throw new BibError(`the key "${key}" isn't followed by a comma`);
			const label = key || `line ${startLine}`;
			const fields: Record<string, string> = {};
			for (;;) {
				skipSpace();
				if (i >= s.length) throw new BibError("the entry isn't closed");
				if (s[i] === close) {
					i++;
					break;
				}
				if (s[i] === ",") {
					i++;
					continue;
				}
				const f = s.slice(i).match(/^([^\s=,{}()"#]+)\s*=/);
				if (!f) {
					if (s[i] === "@" || ENTRY_START.test("\n" + s.slice(i, i + 40))) throw new BibError("the entry isn't closed");
					throw new BibError(`can't read a field on line ${lineAt(i)}`);
				}
				i += f[0].length;
				const name = f[1].toLowerCase();
				const v = value((m) => diagnostics.push({ record: label, problem: `undefined macro "${m}" in ${name}, kept as text` }));
				if (name in fields) diagnostics.push({ record: label, problem: `${name} appears twice; the first is kept` });
				else fields[name] = v;
			}
			entries.push({ type, key, fields, line: startLine });
		} catch (e) {
			if (!(e instanceof BibError)) throw e;
			diagnostics.push({ record: `@${type} on line ${startLine}`, problem: `${e.message}; skipped` });
			// Resume at the next line that starts an entry.
			const next = s.slice(at + 1).search(/\n[ \t]*@[a-zA-Z]+[ \t]*[{(]/);
			i = next < 0 ? s.length : at + 1 + next + 1;
		}
	}
	return { entries, diagnostics };
}

/** BibTeX's file field: JabRef's "description:path:type;…", Zotero's and Mendeley's ":path:pdf", or bare paths. */
export function bibFiles(v: string | undefined): string[] {
	if (!v) return [];
	// Splits on unescaped separators; `unescape` removes the escapes from the pieces.
	const split = (s: string, sep: string, unescape = true) => {
		const out: string[] = [];
		let cur = "";
		for (let i = 0; i < s.length; i++) {
			if (s[i] === "\\" && i + 1 < s.length) cur += unescape ? s[++i] : s[i] + s[++i];
			else if (s[i] === sep) {
				out.push(cur);
				cur = "";
			} else cur += s[i];
		}
		out.push(cur);
		return out;
	};
	// Escaped separators are only JabRef's: an unescaped Windows path keeps its backslashes.
	const escaped = /\\[:;]/.test(v);
	return (escaped ? split(v, ";", false) : v.split(";"))
		.map((f) => {
			const parts = escaped ? split(f, ":") : f.split(":");
			if (parts.length < 3) return parts.join(":").trim();
			// "desc:C:\path\file.pdf:PDF" has the drive letter as its own part.
			return parts.slice(1, -1).join(":").trim();
		})
		.filter(Boolean);
}

const pick = (f: Record<string, string>, ...names: string[]) => {
	for (const n of names) {
		const v = f[n];
		if (v === undefined) continue;
		const d = VERBATIM.has(n) ? v.replace(/[{}]/g, "").trim() : decodeLatex(v);
		if (d) return d;
	}
	return undefined;
};

/** One entry as an import record. */
export function bibEntryToRecord(e: BibEntry, diagnostics: Diagnostic[]): ImportRecord {
	const f = e.fields;
	const label = e.key || `line ${e.line}`;
	const problem = (p: string) => diagnostics.push({ record: label, problem: p });
	if (!e.key) problem("no citekey; one is made from the pattern in settings");
	let type = BIB_TO_TYPE[e.type];
	if (!type) {
		problem(`entry type @${e.type} imported as a document`);
		type = "document";
	}
	const people = (k: string) => {
		const { names, others } = bibNames(f[k]);
		return { names, others };
	};
	const au = people("author");
	const ed = people("editor");
	const tr = people("translator");
	const title = joinTitle(pick(f, "title"), pick(f, "subtitle"));
	if (!title) problem("no title");
	// BibLaTeX's date, or BibTeX's year and month.
	let date = parseDate(pick(f, "date")?.split("/")[0]);
	if (!date) {
		const year = pick(f, "year");
		const month = pick(f, "month");
		const m = month ? (/^\d{1,2}$/.test(month) ? Number(month) : MONTHS.findIndex((x) => x.toLowerCase().startsWith(month.toLowerCase().slice(0, 3))) + 1) : 0;
		date = year ? parseDate(m ? `${year.match(/\d{4}/)?.[0] ?? year}-${String(m).padStart(2, "0")}` : year) : undefined;
		if (year && !date) problem(`year "${year}" can't be read`);
	}
	const container = pick(f, "journaltitle", "journal", "booktitle");
	const doi = pick(f, "doi");
	const isbn = pick(f, "isbn")
		?.split(/[\s,;]+/)
		.map((s) => canonicalIsbn(s))
		.find(Boolean);
	let url = pick(f, "url");
	const howpublished = pick(f, "howpublished");
	if (!url && howpublished && /^https?:\/\/\S+$/.test(howpublished)) url = howpublished;
	const eprintType = (pick(f, "eprinttype", "archiveprefix") ?? "").toLowerCase();
	const eprint = pick(f, "eprint");
	if (!url && eprint && eprintType === "arxiv") url = `https://arxiv.org/abs/${eprint}`;
	const list = (n: PersonName[]) => (n.length ? n.map(displayName) : undefined);
	const data: ReferenceData = {
		type,
		title,
		authors: au.names.map(displayName),
		familyNames: (au.names.length ? au.names : ed.names).map(familyOf),
		editors: list(ed.names),
		translators: list(tr.names),
		names: { authors: au.names, editors: ed.names, translators: tr.names },
		date,
		year: yearOf(date),
		publisher: pick(f, "publisher", "institution", "school", "organization"),
		place: pick(f, "location", "address"),
		journal: container,
		volume: pick(f, "volume"),
		issue: pick(f, "number", "issue"),
		pages: pick(f, "pages")?.replace(/\s*[–—]\s*/g, "-"),
		edition: pick(f, "edition"),
		series: pick(f, "series"),
		language: pick(f, "langid", "language"),
		isbn: isbn ?? undefined,
		issn: pick(f, "issn"),
		doi: doi ? normalizeDoi(doi) ?? undefined : undefined,
		url,
		accessed: parseDate(pick(f, "urldate")),
		abstract: pick(f, "abstract"),
		source: "BibTeX",
	};
	for (const k of Object.keys(data) as (keyof ReferenceData)[]) if (data[k] === undefined) delete data[k];
	if (doi && !data.doi) problem(`doi "${doi}" isn't a DOI`);
	const unmapped = Object.keys(f).filter((k) => !MAPPED.has(k) && !BOOKKEEPING.has(k) && decodeLatex(f[k]));
	if (howpublished && url !== howpublished) unmapped.push("howpublished");
	if (eprint && !(eprintType === "arxiv" && url?.includes(eprint))) unmapped.push("eprint");
	return {
		label,
		citekey: e.key || undefined,
		sourceType: `@${e.type}`,
		data,
		tags: splitKeywords(pick(f, "keywords")).map((tag) => ({ tag })),
		collections: splitKeywords(pick(f, "groups")),
		// BibDesk's pdf field and the standard file field.
		attachments: [...bibFiles(f.file?.trim()), ...(pick(f, "pdf") ? [pick(f, "pdf")!] : [])],
		added: parseDate(pick(f, "date-added", "creationdate", "timestamp")),
		notes: ["note", "annote", "annotation"].map((k) => pick(f, k)).filter((n): n is string => !!n),
		unmapped,
	};
}

/** Parse a BibTeX or BibLaTeX file. Malformed entries and duplicate keys are reported and skipped. */
export function parseBibtex(text: string): ParseResult {
	const { entries, diagnostics } = parseBibEntries(text);
	const records: ImportRecord[] = [];
	const seen = new Set<string>();
	for (const e of entries) {
		if (e.key) {
			if (seen.has(e.key.toLowerCase())) {
				diagnostics.push({ record: e.key, problem: `key used by an earlier entry; the one on line ${e.line} is skipped` });
				continue;
			}
			seen.add(e.key.toLowerCase());
		}
		records.push(bibEntryToRecord(e, diagnostics));
	}
	return { records, diagnostics };
}
