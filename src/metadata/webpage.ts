import { familyFromFullName } from "../citekey";
import { canonicalIsbn } from "../identifiers";
import { parseDate, yearOf } from "./dates";
import { Found, mergeFound } from "./found";
import { parseHtml, tidy } from "./html";
import { Fetcher } from "./http";
import { readJsonLd } from "./jsonld";
import { siteLayer } from "./sites";
import { ReferenceData } from "./types";

/** <meta> tags as a multimap keyed by lower-cased name, property or itemprop. */
export function readMeta(doc: Document): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const m of Array.from(doc.querySelectorAll("meta"))) {
		const key = m.getAttribute("name") ?? m.getAttribute("property") ?? m.getAttribute("itemprop");
		const content = m.getAttribute("content");
		if (!key || content === null) continue;
		const k = key.toLowerCase();
		out.set(k, [...(out.get(k) ?? []), content]);
	}
	return out;
}

function httpUrl(v: string | undefined): string | undefined {
	if (!v || !/^https?:\/\//i.test(v)) return undefined;
	try {
		new URL(v);
		return v;
	} catch {
		return undefined;
	}
}

const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/i;

/**
 * The standard tags: Highwire (citation_*, used by Google Scholar), Dublin Core, PRISM,
 * Open Graph, and plain HTML. Same coverage as Zotero's Embedded Metadata translator.
 */
function metaLayer(doc: Document): Found {
	const meta = readMeta(doc);
	const one = (...keys: string[]) => {
		for (const k of keys) {
			const v = meta.get(k)?.map((x) => tidy(x)).find(Boolean);
			if (v) return v;
		}
		return undefined;
	};
	const many = (...keys: string[]) => {
		for (const k of keys) {
			const v = (meta.get(k) ?? []).map((x) => tidy(x)).filter((x): x is string => !!x && !/^https?:\/\//.test(x));
			if (v.length) return v;
		}
		return [];
	};
	const docTitle = tidy(doc.querySelector("title")?.textContent ?? undefined);
	const site = one("og:site_name", "application-name");
	const highwire = many("citation_author", "dc.creator", "dcterms.creator", "author", "article:author", "book:author", "parsely-author", "sailthru.author");
	return {
		type: one("citation_journal_title") ? "article" : undefined,
		title: one("citation_title", "dc.title", "dcterms.title", "og:title", "twitter:title") ?? stripSite(docTitle, site),
		// Highwire and Dublin Core use "Last, First"; turn it into display order.
		authors: highwire.map((a) => (/^[^,]+,[^,]+$/.test(a) ? a.split(",").map((x) => x.trim()).reverse().join(" ") : a)),
		date: parseDate(
			one(
				"citation_publication_date", "citation_date", "citation_online_date", "dc.date", "dcterms.issued", "dcterms.date", "dc.date.issued",
				"prism.publicationdate", "article:published_time", "book:release_date", "date", "datepublished", "pubdate", "uploaddate"
			)
		),
		journal: one("citation_journal_title", "citation_conference_title", "prism.publicationname", "og:site_name", "application-name"),
		publisher: one("citation_publisher", "dc.publisher", "dcterms.publisher"),
		isbn: [one("citation_isbn"), one("book:isbn"), one("books:isbn")].map((v) => (v ? canonicalIsbn(v) : null)).find(Boolean) ?? undefined,
		doi: one("citation_doi", "prism.doi", "dc.identifier", "dcterms.identifier")?.replace(/^(doi:\s*|https?:\/\/(dx\.)?doi\.org\/)/i, "").match(/^10\.\S+/)?.[0],
		url: httpUrl(one("og:url")),
		abstract: one("citation_abstract", "dc.description", "dcterms.abstract", "description", "og:description", "twitter:description"),
	};
}

/** "Article | Site" -> "Article" when Site is the page's site name. */
function stripSite(title: string | undefined, site: string | undefined): string | undefined {
	if (!title || !site) return title;
	const m = title.match(/^(.*\S)\s+[|\-–—·:]\s+(.+)$/);
	return m && m[2].trim().toLowerCase() === site.toLowerCase() ? m[1] : title;
}

export function parseWebpage(html: string, url: string): ReferenceData {
	const doc = parseHtml(html);
	const ld = readJsonLd(doc);
	const meta = metaLayer(doc);
	// Most trusted first: what we know about the site, then schema.org, then the tags.
	const found = mergeFound(siteLayer(doc, url, ld), ld, meta);
	let host = "";
	try {
		host = new URL(url).hostname;
	} catch {
		/* keep empty */
	}
	const authors = found.authors ?? [];
	return {
		type: found.type ?? (VIDEO_HOSTS.test(host) ? "video" : "webpage"),
		title: found.title ?? url,
		authors,
		familyNames: authors.map(familyFromFullName),
		date: found.date,
		year: yearOf(found.date),
		journal: found.type === "book" ? undefined : found.journal,
		publisher: found.publisher,
		isbn: found.isbn,
		doi: found.doi,
		// Only trust a page's own URL when it is an absolute http(s) URL; never a javascript: or data: link.
		url: httpUrl(found.url) ?? url,
		abstract: found.abstract,
		source: "web page",
	};
}

/**
 * A bot check or sign-in wall served in place of the page (Kobo's "Challenged", Cloudflare's
 * "Just a moment...", Amazon's captcha). Its title and tags describe the wall, not the work.
 */
export function isBlockPage(html: string): boolean {
	const head = html.slice(0, 20_000);
	const title = head.match(/<title[^>]*>([^<]*)/i)?.[1].trim() ?? "";
	return (
		/^(Challenged|Just a moment|Attention Required|Access Denied|Robot Check|Are you a (human|robot)|Security check|Pardon Our Interruption)\b/i.test(title) ||
		/\/errors\/validateCaptcha|captcha-delivery\.com/i.test(html.slice(0, 200_000))
	);
}

export async function lookupWebpage(fetch: Fetcher, url: string): Promise<ReferenceData | null> {
	const res = await fetch(url, { Accept: "text/html,application/xhtml+xml" });
	if (res.status < 200 || res.status >= 400 || isBlockPage(res.text)) return null;
	return parseWebpage(res.text, url);
}
