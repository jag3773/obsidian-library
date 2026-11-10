import { canonicalIsbn } from "../identifiers";
import { parseDate } from "./dates";
import { Found } from "./found";
import { tidy } from "./html";

/**
 * COinS: an OpenURL ContextObject in the title of <span class="Z3988">, used by library
 * catalogs, repositories and some journal and blog platforms. Pure module.
 *
 * A page can carry COinS for works it cites (Wikipedia puts one on every reference), so a
 * span is only read as the page's own description when it is the page's only one.
 */

/** OpenURL genres mapped to this plugin's type vocabulary. */
const GENRES: Record<string, string> = {
	article: "article",
	journal: "article",
	issue: "article",
	preprint: "paper",
	proceeding: "paper",
	conference: "paper",
	book: "book",
	bookitem: "chapter",
	report: "report",
	document: "document",
	unknown: "document",
	dissertation: "thesis",
};

const LIMIT = 4000;

/** The key/value pairs of one ContextObject, decoded. Repeated keys (rft.au, rft_id) keep every value. */
export function parseContextObject(title: string): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const pair of title.slice(0, 20_000).split("&").slice(0, 200)) {
		const eq = pair.indexOf("=");
		if (eq <= 0) continue;
		let key: string;
		let value: string;
		try {
			key = decodeURIComponent(pair.slice(0, eq).replace(/\+/g, " ")).trim().toLowerCase();
			value = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
		} catch {
			continue;
		}
		const v = tidy(value.slice(0, LIMIT));
		if (!key || !v) continue;
		const list = out.get(key);
		if (!list) out.set(key, [v]);
		else if (list.length < 50) list.push(v);
	}
	return out;
}

/** What one ContextObject says about a work. */
export function foundFromContextObject(co: Map<string, string[]>): Found {
	const one = (...keys: string[]) => {
		for (const k of keys) {
			const v = co.get(k)?.[0];
			if (v) return v;
		}
		return undefined;
	};
	const ids = co.get("rft_id") ?? [];
	const id = (re: RegExp) => ids.map((i) => i.match(re)?.[1]).find(Boolean);
	const genre = one("rft.genre")?.toLowerCase();
	const format = one("rft_val_fmt")?.toLowerCase() ?? "";
	const isBook = genre === "book" || (!genre && /:book$/.test(format));
	const isChapter = genre === "bookitem";
	// Full names (rft.au), or rft.aulast with rft.aufirst for the first author.
	let authors = co.get("rft.au") ?? co.get("rft.creator") ?? [];
	const last = one("rft.aulast");
	if (!authors.length && last) authors = [[one("rft.aufirst") ?? one("rft.auinit"), last].filter(Boolean).join(" ")];
	authors = authors.map((a) => (/^[^,]+,[^,]+$/.test(a) ? a.split(",").map((x) => x.trim()).reverse().join(" ") : a));
	const spage = one("rft.spage");
	const epage = one("rft.epage");
	const doi = id(/^(?:info:doi\/|https?:\/\/(?:dx\.)?doi\.org\/|doi:)(10\.\S+)$/i);
	const url = ids.find((i) => /^https?:\/\//i.test(i) && !/doi\.org\//i.test(i)) ?? one("rft.identifier")?.match(/^https?:\/\/\S+$/)?.[0];
	return {
		type: (genre && GENRES[genre]) ?? (isBook ? "book" : /:journal$/.test(format) ? "article" : /:dissertation$/.test(format) ? "thesis" : undefined),
		// A chapter's own title is atitle; a book's is btitle or title.
		title: isBook ? one("rft.btitle", "rft.title") : one("rft.atitle", "rft.title", "rft.btitle"),
		authors,
		date: parseDate(one("rft.date")),
		journal: isBook ? undefined : isChapter ? one("rft.btitle") : one("rft.jtitle", "rft.stitle", "rft.title"),
		publisher: one("rft.pub", "rft.publisher", "rft.inst"),
		place: one("rft.place"),
		volume: one("rft.volume"),
		issue: one("rft.issue"),
		pages: one("rft.pages") ?? (spage ? (epage && epage !== spage ? `${spage}-${epage}` : spage) : undefined),
		edition: one("rft.edition"),
		issn: one("rft.issn", "rft.eissn"),
		isbn: [one("rft.isbn"), id(/^urn:isbn:(\S+)$/i)].map((v) => (v ? canonicalIsbn(v) : null)).find(Boolean) ?? undefined,
		doi,
		pmid: id(/^(?:info:pmid\/|pmid:)(\d{1,9})$/i),
		url,
		language: one("rft.language"),
		abstract: one("rft.description"),
	};
}

/** The ContextObjects in a page's COinS spans, at most `max`. */
export function readCoins(doc: Document, max = 50): Map<string, string[]>[] {
	return Array.from(doc.querySelectorAll("span.Z3988[title]"))
		.slice(0, max)
		.map((el) => parseContextObject(el.getAttribute("title") ?? ""))
		.filter((co) => co.size > 0);
}

const words = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The COinS layer for a page: its only span, when that span describes the page. When other
 * layers found a title, the span's title must match it (one contains the other), so a lone
 * citation on an unrelated page is not taken for the page itself.
 */
export function coinsLayer(doc: Document, pageTitle: string | undefined): Found {
	const all = readCoins(doc, 2);
	if (all.length !== 1) return {};
	const found = foundFromContextObject(all[0]);
	if (!found.title) return {};
	const a = words(found.title);
	const b = words(pageTitle);
	if (b && a !== b && !(a.length >= 8 && b.includes(a)) && !(b.length >= 8 && a.includes(b))) return {};
	return found;
}
