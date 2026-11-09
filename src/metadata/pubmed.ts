import { PersonName, displayName, familyOf } from "../names";
import { parseDate, yearOf } from "./dates";
import { Fetcher, getJson } from "./http";
import { ReferenceData, stripTags } from "./types";

/**
 * PubMed records through NCBI E-utilities esummary (JSON, no API key). Pure parsing plus
 * one request. esummary has no abstract; when the record names a DOI, lookup.ts asks
 * Crossref for the rest.
 */

interface EsummaryAuthor {
	name?: string;
	authtype?: string;
}

interface EsummaryRecord {
	uid?: string;
	error?: string;
	title?: string;
	pubdate?: string;
	epubdate?: string;
	sortpubdate?: string;
	source?: string;
	fulljournalname?: string;
	authors?: EsummaryAuthor[];
	volume?: string;
	issue?: string;
	pages?: string;
	lang?: string[];
	issn?: string;
	essn?: string;
	pubtype?: string[];
	articleids?: { idtype?: string; value?: string }[];
	booktitle?: string;
	publishername?: string;
	publisherlocation?: string;
}

export interface Esummary {
	result?: Record<string, unknown> & { uids?: string[] };
}

export const pubmedUrl = (pmid: string) => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

/**
 * "Smith JA" (family name, then initials) as a name. Collective authors ("WHO Study Group")
 * have authtype "CollectiveName" and stay whole.
 */
function pubmedName(a: EsummaryAuthor): PersonName | undefined {
	const name = a.name?.trim();
	if (!name) return undefined;
	if (a.authtype && !/^author$/i.test(a.authtype)) return { literal: name };
	const m = name.match(/^(.+?)\s+([A-Z]{1,4})(?:\s+(Jr|Sr|2nd|3rd|II|III|IV))?$/);
	if (!m) return { literal: name };
	return { family: m[1], given: m[2].split("").join(". ") + ".", suffix: m[3] };
}

/** PubMed writes "2020 Jan 15", "2020 Jan", "2020 Jan-Feb" or "2020 Spring". */
export function pubmedDate(v: string | undefined): string | undefined {
	const m = v?.trim().match(/^(\d{4})(?:\s+([A-Za-z]{3})[a-z]*(?:\s+(\d{1,2}))?)?/);
	if (!m) return parseDate(v);
	return parseDate(m[3] ? `${m[3]} ${m[2]} ${m[1]}` : m[2] ? `${m[2]} ${m[1]}` : m[1]) ?? parseDate(m[1]);
}

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** A PubMed record from an esummary response, or null when the PMID is unknown. */
export function parsePubmed(json: Esummary | null, pmid: string): ReferenceData | null {
	const rec = json?.result?.[pmid] as EsummaryRecord | undefined;
	if (!rec || typeof rec !== "object" || rec.error) return null;
	// Titles carry a final period and, rarely, inline markup.
	const title = stripTags(rec.title)?.replace(/\.$/, "");
	if (!title) return null;
	const people = (rec.authors ?? []).filter((a) => !a.authtype || /^(author|collectivename)$/i.test(a.authtype));
	const parts = people.map(pubmedName).filter((n): n is PersonName => !!n);
	const ids = new Map((rec.articleids ?? []).map((i) => [String(i.idtype).toLowerCase(), s(i.value)]));
	const doi = ids.get("doi")?.match(/^10\.\S+/)?.[0];
	const date = pubmedDate(s(rec.pubdate)) ?? pubmedDate(s(rec.epubdate)) ?? parseDate(s(rec.sortpubdate));
	const isBook = !!s(rec.booktitle) || (rec.pubtype ?? []).some((t) => /^book$/i.test(t));
	return {
		type: isBook ? "book" : "article",
		title,
		authors: parts.map(displayName),
		familyNames: parts.map(familyOf),
		names: { authors: parts },
		date,
		year: yearOf(date),
		journal: isBook ? undefined : s(rec.fulljournalname) ?? s(rec.source),
		volume: s(rec.volume),
		issue: s(rec.issue),
		pages: s(rec.pages),
		issn: s(rec.issn) ?? s(rec.essn),
		// PubMed uses three-letter codes ("eng").
		language: rec.lang?.map(s).find(Boolean),
		publisher: s(rec.publishername),
		place: s(rec.publisherlocation),
		doi,
		url: pubmedUrl(pmid),
		source: "PubMed",
	};
}

export async function lookupPubmed(fetch: Fetcher, pmid: string): Promise<ReferenceData | null> {
	if (!/^\d{1,9}$/.test(pmid)) return null;
	const json = await getJson<Esummary>(fetch, `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${pmid}`);
	return parsePubmed(json, pmid);
}
