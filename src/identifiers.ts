/** Detect and normalize reference identifiers. Pure module. */

export type IdentifierKind = "isbn" | "doi" | "arxiv" | "url";

export interface Identifier {
	kind: IdentifierKind;
	value: string;
}

/** An explicitly supplied DOI: prefix, slash, then any non-space characters (legacy DOIs use <>;() etc.). */
const DOI_WHOLE_RE = /^10\.\d{4,9}\/\S+$/;
/** Candidate DOIs in free text; boundary punctuation is trimmed afterwards by trimDoi. */
const DOI_TEXT_RE = /\b10\.\d{4,9}\/[^\s"]+/gi;

/**
 * arXiv identifiers, bare, "arXiv:"-prefixed, or as abs/pdf URLs:
 *   new scheme (2007-04 on)  2303.08774, 0704.0001v2
 *   old scheme (to 2007-03)  hep-th/9901001, math.GT/0309136v1
 */
const ARXIV_RE =
	/^(?:arxiv:\s*|https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z]+(?:-[a-z]+)*(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?)(?:\.pdf)?$/i;

export function normalizeIsbn(raw: string): string | null {
	const s = raw.replace(/^isbn(?:-1[03])?:?\s*/i, "").replace(/[\s-]/g, "").toUpperCase();
	if (/^\d{13}$/.test(s) && isbn13Valid(s)) return s;
	if (/^\d{9}[\dX]$/.test(s) && isbn10Valid(s)) return s;
	return null;
}

function isbn13Check(first12: string): number {
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
	return (10 - (sum % 10)) % 10;
}

function isbn13Valid(s: string): boolean {
	return isbn13Check(s) === Number(s[12]);
}

function isbn10Valid(s: string): boolean {
	let sum = 0;
	for (let i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
	return sum % 11 === 0;
}

/**
 * A valid ISBN in canonical ISBN-13 form, for comparing identifiers. An ISBN-10 becomes
 * 978 + its first nine digits + a recomputed check digit. 979 ISBNs have no ISBN-10 form.
 */
export function canonicalIsbn(raw: string): string | null {
	const s = normalizeIsbn(raw);
	if (!s || s.length === 13) return s;
	const first12 = "978" + s.slice(0, 9);
	return first12 + isbn13Check(first12);
}

/** Remove known DOI prefixes and URL encoding from an explicitly supplied DOI, keeping it otherwise intact. */
export function normalizeDoi(raw: string): string | null {
	let s = raw.trim().replace(/^doi:\s*/i, "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
	if (/%[0-9a-f]{2}/i.test(s)) {
		try {
			s = decodeURIComponent(s);
		} catch {
			/* not URL-encoded after all */
		}
	}
	s = s.trim();
	return DOI_WHOLE_RE.test(s) ? s : null;
}

/** Trim prose punctuation from a DOI found in running text, keeping balanced brackets. */
function trimDoi(candidate: string): string {
	let s = candidate;
	const pairs: Record<string, string> = { ")": "(", "]": "[", ">": "<" };
	for (;;) {
		const last = s[s.length - 1];
		if (/[.,;:'!?]/.test(last)) {
			s = s.slice(0, -1);
			continue;
		}
		const open = pairs[last];
		if (open && s.split(last).length > s.split(open).length) {
			s = s.slice(0, -1);
			continue;
		}
		return s;
	}
}

/** Work out what the user typed into the Add reference box. */
export function detectIdentifier(input: string): Identifier | null {
	const s = input.trim();
	if (!s) return null;
	const arxiv = s.match(ARXIV_RE);
	if (arxiv) return { kind: "arxiv", value: arxiv[1] };
	if (/^(doi:|https?:\/\/(dx\.)?doi\.org\/|10\.\d{4,9}\/)/i.test(s)) {
		const doi = normalizeDoi(s);
		if (doi) return { kind: "doi", value: doi };
	}
	const isbn = normalizeIsbn(s);
	if (isbn) return { kind: "isbn", value: isbn };
	if (/^https?:\/\/\S+$/i.test(s)) return { kind: "url", value: s };
	if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return { kind: "url", value: `https://${s}` };
	return null;
}

/** Find the first DOI or ISBN in free text, e.g. the opening pages of a PDF. */
export function findIdentifierInText(text: string): Identifier | null {
	for (const m of text.matchAll(DOI_TEXT_RE)) {
		const doi = trimDoi(m[0]);
		if (DOI_WHOLE_RE.test(doi)) return { kind: "doi", value: doi };
	}
	const isbnRe = /ISBN(?:-1[03])?:?\s*((?:97[89][\s-]?)?(?:\d[\s-]?){9}[\dX])/gi;
	let m: RegExpExecArray | null;
	while ((m = isbnRe.exec(text))) {
		const isbn = normalizeIsbn(m[1]);
		if (isbn) return { kind: "isbn", value: isbn };
	}
	return null;
}
