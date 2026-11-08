/** Detect and normalize reference identifiers. Pure module. */

export type IdentifierKind = "isbn" | "doi" | "arxiv" | "url";

export interface Identifier {
	kind: IdentifierKind;
	value: string;
}

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>]+[^\s"'<>.,;)\]])/i;
const ARXIV_RE = /^(?:arxiv:\s*|https?:\/\/arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?$/i;

export function normalizeIsbn(raw: string): string | null {
	const s = raw.replace(/^isbn(?:-1[03])?:?\s*/i, "").replace(/[\s-]/g, "").toUpperCase();
	if (/^\d{13}$/.test(s) && isbn13Valid(s)) return s;
	if (/^\d{9}[\dX]$/.test(s) && isbn10Valid(s)) return s;
	return null;
}

function isbn13Valid(s: string): boolean {
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
	return (10 - (sum % 10)) % 10 === Number(s[12]);
}

function isbn10Valid(s: string): boolean {
	let sum = 0;
	for (let i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
	return sum % 11 === 0;
}

export function normalizeDoi(raw: string): string | null {
	const m = raw.trim().replace(/^doi:\s*/i, "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").match(DOI_RE);
	return m ? m[1] : null;
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
	const doi = text.match(DOI_RE);
	if (doi) return { kind: "doi", value: doi[1] };
	const isbnRe = /ISBN(?:-1[03])?:?\s*((?:97[89][\s-]?)?(?:\d[\s-]?){9}[\dX])/gi;
	let m: RegExpExecArray | null;
	while ((m = isbnRe.exec(text))) {
		const isbn = normalizeIsbn(m[1]);
		if (isbn) return { kind: "isbn", value: isbn };
	}
	return null;
}
