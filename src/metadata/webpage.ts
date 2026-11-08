import { familyFromFullName } from "../citekey";
import { Fetcher } from "./http";
import { ReferenceData, stripTags, yearFrom } from "./types";

/** Collect <meta> tags as a multimap keyed by lower-cased name/property. Regex based so it runs in Node tests. */
export function readMeta(html: string): Map<string, string[]> {
	const out = new Map<string, string[]>();
	const head = html.slice(0, 400_000);
	for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
		const tagText = m[0];
		const key = attr(tagText, "name") ?? attr(tagText, "property") ?? attr(tagText, "itemprop");
		const content = attr(tagText, "content");
		if (!key || content === undefined) continue;
		const k = key.toLowerCase();
		out.set(k, [...(out.get(k) ?? []), decode(content)]);
	}
	return out;
}

function attr(tagText: string, name: string): string | undefined {
	// Require whitespace before the attribute so "data-name" doesn't match "name".
	const m = tagText.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
	return m ? m[1] ?? m[2] ?? m[3] : undefined;
}

function decode(s: string): string {
	return (stripTags(s) ?? "").replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, n: string) => {
		const code = n[0] === "x" || n[0] === "X" ? parseInt(n.slice(1), 16) : Number(n);
		// fromCodePoint throws on out-of-range values, which a hostile page could supply.
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
	});
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

export function parseWebpage(html: string, url: string): ReferenceData {
	const meta = readMeta(html);
	const one = (...keys: string[]) => {
		for (const k of keys) {
			const v = meta.get(k)?.find((x) => x.trim());
			if (v) return v.trim();
		}
		return undefined;
	};
	const many = (...keys: string[]) => {
		for (const k of keys) {
			const v = (meta.get(k) ?? []).map((x) => x.trim()).filter(Boolean);
			if (v.length) return v;
		}
		return [];
	};

	const docTitle = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
	const title = one("citation_title", "dc.title", "og:title", "twitter:title") ?? docTitle ?? url;
	const authors = many("citation_author", "dc.creator", "author", "article:author", "parsely-author").filter(
		(a) => !/^https?:\/\//.test(a)
	);
	// Highwire uses "Last, First"; turn it into display order.
	const display = authors.map((a) => (a.includes(",") ? a.split(",").map((s) => s.trim()).reverse().join(" ") : a));
	let host = "";
	try {
		host = new URL(url).hostname;
	} catch {
		/* keep empty */
	}
	const isArticle = !!one("citation_journal_title");
	return {
		type: VIDEO_HOSTS.test(host) ? "video" : isArticle ? "article" : "webpage",
		title,
		authors: display,
		familyNames: authors.map(familyFromFullName),
		year: yearFrom(
			one("citation_publication_date", "citation_date", "dc.date", "article:published_time", "date", "datepublished", "uploaddate")
		),
		journal: one("citation_journal_title", "og:site_name", "application-name"),
		publisher: one("citation_publisher", "dc.publisher"),
		doi: one("citation_doi", "dc.identifier")?.replace(/^doi:\s*/i, "").match(/^10\.\S+/)?.[0],
		// Only trust og:url when it is an absolute http(s) URL; never a javascript: or data: link.
		url: httpUrl(one("og:url")) ?? url,
		abstract: one("citation_abstract", "description", "og:description", "dc.description"),
		source: "web page",
	};
}

export async function lookupWebpage(fetch: Fetcher, url: string): Promise<ReferenceData | null> {
	const res = await fetch(url, { Accept: "text/html,application/xhtml+xml" });
	if (res.status < 200 || res.status >= 400) return null;
	return parseWebpage(res.text, url);
}
