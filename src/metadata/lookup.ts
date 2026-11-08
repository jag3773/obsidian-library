import { Identifier } from "../identifiers";
import { lookupArxiv } from "./arxiv";
import { lookupCrossref, lookupDoiOrg } from "./crossref";
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

/** Route an identifier to its sources, with fallbacks. Returns null when nothing is found. */
export async function lookup(fetch: Fetcher, id: Identifier, opts: LookupOptions = {}): Promise<ReferenceData | null> {
	switch (id.kind) {
		case "isbn": {
			const r = await firstOf(
				() => lookupOpenLibrary(fetch, id.value),
				() => lookupGoogleBooks(fetch, id.value)
			);
			// Open Library rarely has abstracts; borrow Google's when available.
			if (r && !r.abstract && r.source === "Open Library") {
				const g = await firstOf(() => lookupGoogleBooks(fetch, id.value));
				if (g?.abstract) r.abstract = g.abstract;
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
			const page = await firstOf(() => lookupWebpage(fetch, id.value));
			if (page?.doi) {
				const work = await lookup(fetch, { kind: "doi", value: page.doi }, opts);
				if (work) return { ...work, url: work.url ?? page.url };
			}
			return page;
		}
	}
}
