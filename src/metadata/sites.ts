import { canonicalIsbn } from "../identifiers";
import { parseDate } from "./dates";
import { Found } from "./found";
import { blockText, htmlToText, text, tidy } from "./html";

/**
 * Readers for sites whose useful metadata isn't in standard tags, modeled on the matching
 * Zotero translators. Each returns only what it found; generic layers fill in the rest.
 */

type Site = (doc: Document, url: URL, ld: Found) => Found;

const hostIs = (url: URL, re: RegExp) => re.test(url.hostname.toLowerCase());

/** "Label : value" rows such as Amazon's product details, keyed by lower-case label. */
function labelledRows(rows: Element[], labelSelector: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const row of rows) {
		const labelEl = row.querySelector(labelSelector);
		const full = tidy(row.textContent ?? "")?.replace(/\s+/g, " ");
		const label = tidy(labelEl?.textContent ?? "")?.replace(/\s+/g, " ");
		if (!full || !label) continue;
		const key = label.replace(/[:\s]+$/g, "").trim().toLowerCase();
		const value = full.slice(full.indexOf(label) + label.length).replace(/^[\s:]+/, "").trim();
		if (key && value && !out.has(key)) out.set(key, value);
	}
	return out;
}

const isbnFrom = (s: string | undefined) => (s ? canonicalIsbn(s) ?? undefined : undefined);

// Amazon ------------------------------------------------------------------------------------

const amazon: Site = (doc) => {
	const title = text(doc, "#productTitle") ?? text(doc, "#ebooksProductTitle");
	const people = Array.from(doc.querySelectorAll("#bylineInfo .author")).map((el) => ({
		name: (text(el, "a.a-link-normal") ?? text(el, "a"))?.replace(/\s*\([^)]*\)\s*$/, "").replace(/,\s*$/, ""),
		role: text(el, ".contribution")?.replace(/[()]/g, "").trim() ?? "",
	}));
	const named = people.filter((p): p is { name: string; role: string } => !!p.name);
	const writers = named.filter((p) => !p.role || /author/i.test(p.role));
	const details = labelledRows(Array.from(doc.querySelectorAll("#detailBullets_feature_div li")), ".a-text-bold");
	const rpi = (name: string) => text(doc, `#rpi-attribute-book_details-${name} .rpi-attribute-value`);
	// Older pages write "Publisher : Ballantine Books; 1st edition (May 4, 2021)".
	const publisherRow = details.get("publisher");
	const publisher = publisherRow?.split(";")[0].replace(/\s*\([^)]*\)\s*$/, "").trim();
	const isbn = isbnFrom(rpi("isbn13") ?? details.get("isbn-13") ?? details.get("isbn-10") ?? rpi("isbn10"));
	const isBook = !!isbn || !!doc.querySelector('[id^="rpi-attribute-book_details"]');
	return {
		type: isBook ? "book" : undefined,
		// Drop format tags such as "[Paperback]" or "(Kindle Edition)".
		title: title?.replace(/(?:\s*[([](?:Paperback|Hardcover|Kindle Edition|Mass Market Paperback|Audio CD|eBook)[)\]])+$/i, ""),
		authors: (writers.length ? writers : named).map((p) => p.name),
		date: parseDate(rpi("publication_date") ?? details.get("publication date") ?? publisherRow?.match(/\(([^)]*\d{4}[^)]*)\)/)?.[1]),
		publisher: publisher || undefined,
		isbn,
		abstract: blockText(doc.querySelector("#bookDescription_feature_div .a-expander-content")) ?? blockText(doc.querySelector("#productDescription")),
	};
};

// Goodreads ---------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

const goodreads: Site = (doc) => {
	let state: Obj | undefined;
	try {
		state = obj(obj(obj(obj(JSON.parse(doc.querySelector("#__NEXT_DATA__")?.textContent ?? "null"))?.props)?.pageProps)?.apolloState);
	} catch {
		state = undefined;
	}
	const found: Found = {
		type: "book",
		title: text(doc, '[data-testid="bookTitle"]'),
		abstract: blockText(doc.querySelector('[data-testid="description"] .Formatted') ?? doc.querySelector('[data-testid="description"]')),
		date: parseDate(text(doc, '[data-testid="publicationInfo"]')),
	};
	if (!state) return found;
	const book = Object.entries(state)
		.filter(([k, v]) => k.startsWith("Book:") && obj(obj(v)?.details) && s(obj(v)?.title))
		.map(([, v]) => obj(v)!)[0];
	if (!book) return found;
	const details = obj(book.details)!;
	const nameOf = (edge: unknown) => s(obj(state![String(obj(obj(edge)?.node)?.__ref)])?.name);
	const secondary = Array.isArray(book.secondaryContributorEdges) ? book.secondaryContributorEdges : [];
	const authors = [nameOf(book.primaryContributorEdge), ...secondary.filter((e) => /author/i.test(String(obj(e)?.role))).map(nameOf)].filter(
		(n): n is string => !!n
	);
	return {
		type: "book",
		title: s(book.titleComplete) ?? s(book.title) ?? found.title,
		authors,
		date: (typeof details.publicationTime === "number" ? parseDate(details.publicationTime) : undefined) ?? found.date,
		publisher: s(details.publisher),
		isbn: isbnFrom(s(details.isbn13) ?? s(details.isbn)),
		abstract: htmlToText(s(book.description)) ?? found.abstract,
	};
};

// Kobo --------------------------------------------------------------------------------------

/** Kobo prefixes its JSON-LD descriptions with a store blurb. */
const KOBO_BLURB = /^Read "[\s\S]*?" by [\s\S]*? available from Rakuten Kobo\.\s*/;

const kobo: Site = (doc, _url, ld) => {
	const release = Array.from(doc.querySelectorAll(".bookitem-secondary-metadata li")).find((li) => /release date/i.test(li.textContent ?? ""));
	return {
		abstract: blockText(doc.querySelector(".synopsis-description")) ?? ld.abstract?.replace(KOBO_BLURB, "") ?? undefined,
		date: parseDate(release?.textContent ?? undefined),
	};
};

// GitHub ------------------------------------------------------------------------------------

const RESERVED = new Set(
	"about apps collections contact customer-stories enterprise events explore features issues login marketplace new notifications orgs organizations pricing pulls readme search security settings site sponsors team topics trending users".split(" ")
);

/** owner/repo for a GitHub repository page (the root, or a tree/blob view inside it). */
export function githubRepo(url: string): { owner: string; repo: string } | undefined {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return undefined;
	}
	if (u.hostname.toLowerCase() !== "github.com") return undefined;
	const [owner, repo, view] = u.pathname.split("/").filter(Boolean);
	if (!owner || !repo || RESERVED.has(owner.toLowerCase())) return undefined;
	if (view && !(view === "tree" || view === "blob")) return undefined;
	if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return undefined;
	return { owner, repo: repo.replace(/\.git$/, "") };
}

const github: Site = (doc, url) => {
	const r = githubRepo(url.href);
	if (!r) return {};
	const og = doc.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? undefined;
	// GitHub appends a period and a sign-up line to the repository's description.
	const tail = ` Contribute to ${r.owner}/${r.repo} development by creating an account on GitHub.`;
	const about = og?.endsWith(tail) ? og.slice(0, -tail.length).replace(/\.$/, "").trim() : og?.trim();
	return {
		type: "software",
		title: r.repo,
		authors: [r.owner],
		journal: "GitHub",
		abstract: about && !/^Contribute to /.test(about) ? about : undefined,
	};
};

const SITES: [RegExp, Site][] = [
	[/(^|\.)amazon\.(com|ca|co\.uk|com\.au|de|fr|it|es|nl|in|co\.jp|com\.br|com\.mx|se|pl|sg)$/, amazon],
	[/(^|\.)goodreads\.com$/, goodreads],
	[/(^|\.)kobo\.com$/, kobo],
	[/^github\.com$/, github],
];

/** The site-specific layer for url, or nothing for other sites. */
export function siteLayer(doc: Document, url: string, ld: Found): Found {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return {};
	}
	const site = SITES.find(([re]) => hostIs(u, re));
	if (!site) return {};
	try {
		return site[1](doc, u, ld);
	} catch (e) {
		console.warn("[library] site reader failed", u.hostname, e);
		return {};
	}
}
