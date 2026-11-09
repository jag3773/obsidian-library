import { canonicalIsbn } from "../identifiers";
import { parseDate } from "./dates";
import { Found } from "./found";
import { htmlToText, tidy } from "./html";

/** schema.org data in <script type="application/ld+json">, the richest source on most sites. */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** A plain string value (schema.org allows text or an object with a name or @value). */
function str(v: unknown): string | undefined {
	for (const x of list(v)) {
		if (typeof x === "string" && x.trim()) return x.trim();
		if (typeof x === "number") return String(x);
		if (isObj(x)) {
			const inner = x["@value"] ?? x.name;
			if (typeof inner === "string" && inner.trim()) return inner.trim();
		}
	}
	return undefined;
}

function types(o: Obj): string[] {
	return list(o["@type"]).filter((t): t is string => typeof t === "string").map((t) => t.replace(/^.*[/#]/, ""));
}

/** Every object in the page's JSON-LD, with @graph and arrays flattened. */
export function jsonLdObjects(doc: Document): Obj[] {
	const out: Obj[] = [];
	const visit = (v: unknown, depth: number) => {
		if (depth > 4) return;
		for (const x of list(v)) {
			if (!isObj(x)) continue;
			if (x["@graph"]) visit(x["@graph"], depth + 1);
			if (x["@type"]) out.push(x);
		}
	};
	for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
		try {
			visit(JSON.parse(s.textContent ?? ""), 0);
		} catch {
			/* a broken block doesn't stop the others */
		}
	}
	return out;
}

const ARTICLE = /^(ScholarlyArticle|Article|NewsArticle|ReportageNewsArticle|AnalysisNewsArticle|BlogPosting|SocialMediaPosting|TechArticle|Report|LiveBlogPosting|OpinionNewsArticle)$/;
const RANK: [RegExp, string][] = [
	[/^ScholarlyArticle$/, "article"],
	[/^(Book|Audiobook)$/, "book"],
	[ARTICLE, "webpage"],
	[/^(SoftwareSourceCode|SoftwareApplication)$/, "software"],
	[/^(VideoObject|Movie|TVEpisode)$/, "video"],
	[/^(Thesis)$/, "thesis"],
	[/^(Chapter)$/, "chapter"],
	[/^(CreativeWork|Dataset|PodcastEpisode)$/, "webpage"],
];

/** The page's main work: the most specific creative work type found. */
function primary(objs: Obj[]): { item: Obj; type: string } | undefined {
	for (const [re, type] of RANK) {
		const item = objs.find((o) => types(o).some((t) => re.test(t)));
		if (item) return { item, type };
	}
	return undefined;
}

function people(v: unknown): string[] {
	return list(v)
		.map((p) => (typeof p === "string" ? p.trim() : isObj(p) ? str(p.name) ?? [str(p.givenName), str(p.familyName)].filter(Boolean).join(" ") : ""))
		.filter((n): n is string => !!n && !/^https?:\/\//.test(n));
}

/** schema.org values are often HTML-escaped or contain markup. */
const clean = (s: string | undefined) => (s && /[<&]/.test(s) ? htmlToText(s) : tidy(s));

function isbnOf(o: Obj): string | undefined {
	for (const v of [o.isbn, o.gtin13, o.gtin, o.isbn13]) {
		const s = str(v);
		const c = s ? canonicalIsbn(s) : null;
		// A store's gtin13 is only an ISBN when it carries the Bookland prefix.
		if (c && /^97[89]/.test(c)) return c;
	}
	return undefined;
}

function doiOf(o: Obj): string | undefined {
	for (const v of [...list(o.identifier), ...list(o.sameAs), o["@id"]]) {
		const s = isObj(v) ? str(v.value) ?? str(v["@value"]) : typeof v === "string" ? v : undefined;
		const m = s?.match(/\b(10\.\d{4,9}\/\S+)/);
		if (m) return m[1];
	}
	return undefined;
}

function fromItem(o: Obj): Found {
	return {
		title: clean(str(o.name) ?? str(o.headline)),
		authors: people(o.author ?? o.creator).map((a) => clean(a) ?? a),
		date: parseDate(str(o.datePublished) ?? str(o.dateCreated) ?? str(o.releasedate) ?? str(o.uploadDate) ?? str(o.copyrightYear)),
		publisher: clean(str(o.publisher)),
		journal: clean(str((isObj(o.isPartOf) ? o.isPartOf : undefined)?.name)),
		isbn: isbnOf(o),
		doi: doiOf(o),
		url: str(o.url),
		abstract: clean(str(o.abstract) ?? str(o.description)),
	};
}

/**
 * The main work in the page's JSON-LD. A Book's workExample (an edition) fills in what the
 * work lacks, such as the ISBN and publication date, and a Product for the same item
 * (a store listing) fills in the rest.
 */
export function readJsonLd(doc: Document): Found & { type?: string } {
	const objs = jsonLdObjects(doc);
	const main = primary(objs);
	if (!main) return {};
	const found: Found = { type: main.type, ...fromItem(main.item) };
	const extras = [
		...list(main.item.workExample).filter(isObj),
		...objs.filter((o) => types(o).includes("Product") && str(o.name) === str(main.item.name)),
	];
	for (const extra of extras) {
		const more = fromItem(extra);
		for (const k of Object.keys(more) as (keyof Found)[]) {
			const have = found[k];
			if (have === undefined || (Array.isArray(have) && !have.length)) (found as Record<string, unknown>)[k] = more[k];
		}
	}
	if (main.type === "webpage" && found.isbn) found.type = "book";
	return found;
}
