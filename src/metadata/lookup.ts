import { Identifier } from "../identifiers";
import { lookupArxiv } from "./arxiv";
import { lookupCrossref, lookupDoiOrg } from "./crossref";
import { lookupGitHub } from "./github";
import { lookupGoogleBooks } from "./googlebooks";
import { Fetcher } from "./http";
import { lookupOpenLibrary } from "./openlibrary";
import { ReferenceData } from "./types";
import { lookupWebpage } from "./webpage";

export interface LookupOptions {
	crossrefMailto?: string;
}

async function firstOf(...tries: (() => Promise<ReferenceData | null>)[]): Promise<ReferenceData | null> {
	for (const t of tries) {
		try {
			const r = await t();
			if (r) return r;
		} catch (e) {
			console.warn("[library] lookup source failed", e);
		}
	}
	return null;
}

const GAP_FIELDS = ["publisher", "abstract", "place", "edition", "series", "language", "volume", "issue", "pages", "issn", "journal"] as const;
const GAP_PEOPLE = ["editors", "translators", "contributors"] as const;

/** page with each empty field taken from more. */
export function fillGaps(page: ReferenceData, more: ReferenceData): ReferenceData {
	const out: ReferenceData = { ...page, names: { ...page.names } };
	if (!out.authors.length && more.authors.length) {
		out.authors = more.authors;
		out.familyNames = more.familyNames;
		out.names!.authors = more.names?.authors;
	}
	for (const k of GAP_PEOPLE) {
		if (!out[k]?.length && more[k]?.length) {
			out[k] = more[k];
			out.names![k] = more.names?.[k];
		}
	}
	if (!out.date && more.date) {
		out.date = more.date;
		out.year = more.year;
	}
	out.year ??= more.year;
	for (const k of GAP_FIELDS) out[k] ??= more[k];
	return out;
}

/** Route an identifier to its sources, with fallbacks. Returns null when nothing is found. */
export async function lookup(fetch: Fetcher, id: Identifier, opts: LookupOptions = {}): Promise<ReferenceData | null> {
	switch (id.kind) {
		case "isbn": {
			const r = await firstOf(
				() => lookupOpenLibrary(fetch, id.value),
				() => lookupGoogleBooks(fetch, id.value)
			);
			// Open Library records are often sparse (no description, sometimes no authors or
			// date); fill what it lacks from Google Books, keeping Open Library's own values.
			if (r && r.source === "Open Library" && (!r.abstract || !r.authors.length || !r.date || !r.publisher)) {
				const g = await firstOf(() => lookupGoogleBooks(fetch, id.value));
				if (g) return fillGaps(r, g);
			}
			return r;
		}
		case "doi":
			return firstOf(
				() => lookupCrossref(fetch, id.value, opts.crossrefMailto),
				() => lookupDoiOrg(fetch, id.value)
			);
		case "arxiv":
			return firstOf(() => lookupArxiv(fetch, id.value));
		case "url": {
			const r = await lookupUrl(fetch, id.value, opts);
			// Web sources change; citations of them carry the date they were read. A work found
			// through its DOI is the published version, so it doesn't need one.
			return r && !r.doi ? { ...r, accessed: r.accessed ?? today() } : r;
		}
	}
}

/** The local calendar date, YYYY-MM-DD. */
export function today(now = new Date()): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

async function lookupUrl(fetch: Fetcher, url: string, opts: LookupOptions): Promise<ReferenceData | null> {
	const repo = await firstOf(() => lookupGitHub(fetch, url));
	if (repo) return repo;
	const page = await firstOf(() => lookupWebpage(fetch, url));
	if (page?.doi) {
		const work = await lookup(fetch, { kind: "doi", value: page.doi }, opts);
		if (work) return { ...work, url: work.url ?? page.url };
	}
	// A book page (a store, Goodreads) often lacks a date, publisher or description that
	// the ISBN's catalog record has. The page's own values win; the record fills gaps.
	if (page?.isbn && (!page.authors.length || !page.date || !page.publisher || !page.abstract)) {
		const book = await lookup(fetch, { kind: "isbn", value: page.isbn }, opts);
		if (book) return fillGaps(page, book);
	}
	return page;
}
