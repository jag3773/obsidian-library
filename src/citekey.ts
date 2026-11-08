/**
 * Citekey generation using a subset of Better BibTeX's formula language.
 * Pure module: no Obsidian imports, unit tested in test/citekey.test.ts.
 *
 * Supported terms (joined by "+"):
 *   auth, auth.lower, auth.upper     first author's family name
 *   authors(n)[.lower|.upper]        first n family names, concatenated
 *   shorttitle(n, m)                 first n significant title words, first m capitalized
 *   veryshorttitle                   shorttitle(1, 1)
 *   title                            all significant words, capitalized
 *   year                             four-digit year
 *   "literal" or 'literal'           literal text
 */

export interface CitekeyInput {
	title?: string;
	/** Family names in order. For organisations, the full name. */
	authors?: string[];
	year?: number | string;
}

// Better BibTeX's default skip words.
const SKIP = new Set(
	(
		"a ab aboard about above across after against al along amid among an and anti around as at before behind below " +
		"beneath beside besides between beyond but by d da das de del dell dello dei degli della delle dem den der des " +
		"despite die do down du during ein eine einem einen einer eines el en et except for from gli i il in inside into " +
		"is l la las le les like lo los near nor of off on onto or over past per plus round save since so some sur than " +
		"the through to toward towards un una unas uno unos under underneath une unlike until up upon versus via von " +
		"while with within without yet zu zum"
	).split(" ")
);

const SPECIAL: Record<string, string> = {
	ß: "ss", æ: "ae", Æ: "AE", ø: "o", Ø: "O", ł: "l", Ł: "L", đ: "d", Đ: "D", œ: "oe", Œ: "OE", þ: "th", Þ: "Th",
};

/** Strip diacritics and map letters that NFKD does not decompose. */
export function asciiFold(s: string): string {
	return s
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.replace(/[ßæÆøØłŁđĐœŒþÞ]/g, (c) => SPECIAL[c] ?? c);
}

/** Fold to ASCII and drop anything that is not a letter or digit. */
export function fold(s: string): string {
	return asciiFold(s).replace(/[^A-Za-z0-9]/g, "");
}

/**
 * Split a title into words the way Better BibTeX does for shorttitle.
 * Apostrophes, hyphens and periods join ("Paul's" -> "Pauls", "Client-side" -> "Clientside",
 * "Amazon.com" -> "Amazoncom"); any other punctuation or whitespace splits ("24:14" -> "24", "14").
 */
export function titleWords(title: string): string[] {
	return title
		.replace(/['’ʼ`.\-‐‑–]/g, (c) => (c === "–" ? " " : ""))
		.split(/[^\p{L}\p{N}]+/u)
		.map(fold)
		.filter((w) => w.length > 0);
}

function significant(title: string): string[] {
	return titleWords(title).filter((w) => !SKIP.has(w.toLowerCase()));
}

function cap(w: string): string {
	return w.charAt(0).toUpperCase() + w.slice(1);
}

export function shorttitle(title: string | undefined, n: number, m: number): string {
	if (!title) return "";
	return significant(title)
		.slice(0, n)
		.map((w, i) => (i < m ? cap(w) : w))
		.join("");
}

/** Family names keep periods and hyphens ("abbott-smith", "a.benwagner"), as Better BibTeX does. */
function familyName(a: string): string {
	return asciiFold(a).replace(/[^A-Za-z0-9.\-]/g, "");
}

function applyCase(s: string, mod?: string): string {
	if (mod === "lower") return s.toLowerCase();
	if (mod === "upper") return s.toUpperCase();
	return s;
}

export interface Term {
	kind: "auth" | "authors" | "shorttitle" | "title" | "year" | "literal";
	args: number[];
	mod?: string;
	text?: string;
}

export function parsePattern(pattern: string): Term[] {
	const terms: Term[] = [];
	for (const raw of pattern.split("+").map((t) => t.trim()).filter(Boolean)) {
		const lit = raw.match(/^(["'])(.*)\1$/);
		if (lit) {
			terms.push({ kind: "literal", args: [], text: lit[2] });
			continue;
		}
		const m = raw.match(/^([a-zA-Z]+)(?:\(([^)]*)\))?(?:\.(lower|upper))?$/);
		if (!m) throw new Error(`Unrecognised citekey term: ${raw}`);
		const name = m[1].toLowerCase();
		const args = (m[2] ?? "")
			.split(",")
			.map((a) => a.trim())
			.filter(Boolean)
			.map(Number);
		const mod = m[3];
		switch (name) {
			case "auth":
				terms.push({ kind: "auth", args: [], mod });
				break;
			case "authors":
				terms.push({ kind: "authors", args: [args[0] ?? 1], mod });
				break;
			case "shorttitle":
				terms.push({ kind: "shorttitle", args: [args[0] ?? 3, args[1] ?? 0], mod });
				break;
			case "veryshorttitle":
				terms.push({ kind: "shorttitle", args: [1, 1], mod });
				break;
			case "title":
				terms.push({ kind: "title", args: [], mod });
				break;
			case "year":
				terms.push({ kind: "year", args: [], mod });
				break;
			default:
				throw new Error(`Unsupported citekey function: ${name}`);
		}
	}
	return terms;
}

export function generateCitekey(input: CitekeyInput, pattern: string): string {
	const authors = (input.authors ?? []).filter(Boolean);
	let out = "";
	for (const t of parsePattern(pattern)) {
		switch (t.kind) {
			case "auth":
				out += authors.length ? applyCase(familyName(authors[0]), t.mod) : "";
				break;
			case "authors":
				out += applyCase(authors.slice(0, t.args[0]).map(familyName).join(""), t.mod);
				break;
			case "shorttitle":
				out += applyCase(shorttitle(input.title, t.args[0], t.args[1]), t.mod);
				break;
			case "title": {
				const words = significant(input.title ?? "");
				out += applyCase(words.map(cap).join(""), t.mod);
				break;
			}
			case "year": {
				const y = String(input.year ?? "").match(/\d{4}/);
				out += y ? y[0] : "";
				break;
			}
			case "literal":
				out += t.text ?? "";
				break;
		}
	}
	return out || "untitled";
}

/** Better BibTeX-style disambiguation: key, keya, keyb, ... keyz, keyaa ... */
export function disambiguate(key: string, taken: (k: string) => boolean): string {
	if (!taken(key)) return key;
	for (let i = 0; i < 26 * 27; i++) {
		const suffix =
			i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(96 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
		if (!taken(key + suffix)) return key + suffix;
	}
	throw new Error(`Could not disambiguate citekey ${key}`);
}

/** Pull a family name out of "First Last", "Last, First" or an organisation name. */
export function familyFromFullName(name: string): string {
	const n = name.trim();
	if (n.includes(",")) return n.split(",")[0].trim();
	const parts = n.split(/\s+/);
	return parts[parts.length - 1];
}
