/**
 * Pure module: format citation records (src/citation.ts) with a CSL style, through
 * citeproc-js. The processor and the bundled style and locale are loaded on first use, so
 * starting the plugin doesn't pay for them. Nothing here imports Obsidian.
 *
 * The bundled style (Chicago author-date) and locale (en-US) come from the Citation Style
 * Language project and are licensed CC BY-SA 3.0; see NOTICE.md.
 */
import type { CiteprocCite, Engine } from "citeproc";
import { CslItem, missingFields } from "./citation";

/** A citation or bibliography as HTML (italics kept) and as plain text. */
export interface Formatted {
	html: string;
	text: string;
}

/** One reference within a citation, with an optional locator ("p. 12", "chap. 3", "45"). */
export interface Cite {
	id: string;
	locator?: string;
	prefix?: string;
	suffix?: string;
	suppressAuthor?: boolean;
}

export const BUNDLED_STYLE_TITLE = "Chicago Manual of Style (author-date)";
export const BUNDLED_LOCALE = "en-US";

/** The bundled Chicago author-date style, as CSL XML. */
export async function bundledStyle(): Promise<string> {
	return (await import("./csl/chicago-author-date.csl")).default;
}

/** The bundled en-US locale, as CSL XML. */
export async function bundledLocale(): Promise<string> {
	return (await import("./csl/locales-en-US.xml")).default;
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`))?.[1];

/** What a style says about itself: its title, class (in-text or note) and default locale. */
export function styleInfo(xml: string): { title?: string; class?: string; defaultLocale?: string } {
	const tag = xml.match(/<style\b[^>]*>/)?.[0];
	if (!tag) throw new Error("This isn't a CSL style: it has no <style> element.");
	const title = xml.match(/<info>[\s\S]*?<title>([^<]*)<\/title>/)?.[1]?.trim();
	return { title, class: attr(tag, "class"), defaultLocale: attr(tag, "default-locale") };
}

/** The language a CSL locale file is for, from its xml:lang, e.g. "de-DE". */
export function localeLang(xml: string): string | undefined {
	const tag = xml.match(/<locale\b[^>]*>/)?.[0];
	return tag ? attr(tag, "xml:lang") : undefined;
}

/** A byte-order mark or leading blank lines would stop citeproc-js reading the XML. */
const clean = (xml: string) => xml.trimStart(); // trimStart removes U+FEFF too

/** A locale for a language: the exact one, or one for the same language ("fr" for "fr-CA"). */
function pickLocale(locales: Map<string, string>, lang: string): string | undefined {
	const exact = locales.get(lang);
	if (exact) return exact;
	const base = lang.split("-")[0].toLowerCase();
	for (const [k, v] of locales) if (k.split("-")[0].toLowerCase() === base) return v;
	return undefined;
}

export interface ProcessorOptions {
	/** CSL style XML. */
	style: string;
	/** Extra CSL locale files, beside the bundled en-US. */
	locales?: string[];
	/** Language to format in; defaults to the style's default locale, else the first extra locale, else en-US. */
	lang?: string;
}

/** A CSL style ready to format citations and bibliographies. Build one with CslProcessor.create. */
export class CslProcessor {
	private items = new Map<string, CslItem>();

	private constructor(
		private engine: Engine,
		/** "note" for footnote styles, "in-text" for author-date and numeric ones. */
		readonly styleClass: string,
		readonly title: string | undefined
	) {}

	static async create(opts: ProcessorOptions): Promise<CslProcessor> {
		const style = clean(opts.style);
		const info = styleInfo(style);
		const locales = new Map<string, string>([[BUNDLED_LOCALE, await bundledLocale()]]);
		const extra = (opts.locales ?? []).map(clean);
		for (const xml of extra) {
			const lang = localeLang(xml);
			if (!lang) throw new Error("This isn't a CSL locale: it has no xml:lang.");
			locales.set(lang, xml);
		}
		const lang = opts.lang ?? (extra.length ? localeLang(extra[0]) : undefined);
		const { default: CSL } = await import("citeproc");
		const processor: { current?: CslProcessor } = {};
		const sys = {
			// Unknown languages fall back to en-US, which citeproc-js needs in any case.
			retrieveLocale: (l: string) => pickLocale(locales, l) ?? locales.get(BUNDLED_LOCALE),
			// citeproc-js may annotate the items it's given; hand it copies.
			retrieveItem: (id: string) => {
				const item = processor.current?.items.get(id);
				return item ? (JSON.parse(JSON.stringify(item)) as unknown) : undefined;
			},
		};
		// A chosen locale overrides the style's default-locale; otherwise the style's wins.
		const engine = new CSL.Engine(sys, style, lang ?? info.defaultLocale ?? BUNDLED_LOCALE, !!lang);
		const p = new CslProcessor(engine, info.class ?? "in-text", info.title);
		processor.current = p;
		return p;
	}

	get isNote(): boolean {
		return this.styleClass === "note";
	}

	/** Register exactly these items, dropping earlier ones so edited notes are read again. */
	private use(items: CslItem[]): string[] {
		this.items = new Map(items.map((i) => [i.id, i]));
		const ids = [...this.items.keys()];
		this.engine.updateItems([]);
		this.engine.updateItems(ids);
		return ids;
	}

	/**
	 * A bibliography of the items, sorted as the style says (numeric styles keep the order
	 * given). HTML is wrapped in citeproc-js's csl-bib-body div; text has one entry per line.
	 */
	bibliography(items: CslItem[]): Formatted {
		this.use(items);
		const run = (format: "html" | "text") => {
			this.engine.setOutputFormat(format);
			const out = this.engine.makeBibliography();
			if (!out) throw new Error("This style has no bibliography.");
			return out;
		};
		const [params, entries] = run("html");
		const [, lines] = run("text");
		return {
			html: params.bibstart + entries.join("") + params.bibend,
			text: lines.map((l) => l.trim()).join("\n"),
		};
	}

	/**
	 * One citation of the items, e.g. "(Porter and Kramer 2011, 12)" in an author-date style,
	 * "[1]" in a numeric one, or the footnote text in a note style.
	 */
	citation(items: CslItem[], cites: Cite[] = items.map((i) => ({ id: i.id }))): Formatted {
		this.use(items);
		const cluster: CiteprocCite[] = cites.map((c) => {
			const out: CiteprocCite = { id: c.id };
			const loc = c.locator ? splitLocator(c.locator) : undefined;
			if (loc) Object.assign(out, loc);
			if (c.prefix) out.prefix = c.prefix;
			if (c.suffix) out.suffix = c.suffix;
			if (c.suppressAuthor) out["suppress-author"] = true;
			return out;
		});
		this.engine.setOutputFormat("html");
		const html = this.engine.makeCitationCluster(cluster);
		this.engine.setOutputFormat("text");
		const text = this.engine.makeCitationCluster(cluster);
		return { html, text };
	}
}

/** Locator labels as written in a citation ("p. 12", "chap. 3") and their CSL names. */
const LABELS: [RegExp, string][] = [
	[/^(?:pp?\.?|pages?)\s*/i, "page"],
	[/^(?:chaps?\.?|chapters?)\s*/i, "chapter"],
	[/^(?:secs?\.?|sections?|§+)\s*/i, "section"],
	[/^(?:vols?\.?|volumes?)\s*/i, "volume"],
	[/^(?:figs?\.?|figures?)\s*/i, "figure"],
	[/^(?:nn?\.|notes?)\s*/i, "note"],
	[/^(?:paras?\.?|paragraphs?|¶+)\s*/i, "paragraph"],
	[/^(?:ll?\.|lines?)\s*/i, "line"],
];

/** "p. 12" → { label: "page", locator: "12" }. A bare locator is a page. */
export function splitLocator(raw: string): { label: string; locator: string } | undefined {
	const s = raw.trim();
	if (!s) return undefined;
	for (const [re, label] of LABELS) {
		const m = s.match(re);
		if (m && m[0].length < s.length) return { label, locator: s.slice(m[0].length).trim() };
	}
	return { label: "page", locator: s };
}

/** Records that lack fields their type needs, as "key: issued, publisher" lines. */
export function incomplete(items: CslItem[]): string[] {
	return items.flatMap((i) => {
		const missing = missingFields(i);
		return missing.length ? [`${i.id}: ${missing.join(", ")}`] : [];
	});
}

/** The parts of the Clipboard API used to copy, so tests can pass a stand-in. */
export interface RichClipboard {
	write?: (items: ClipboardItem[]) => Promise<void>;
	writeText: (text: string) => Promise<void>;
}

/**
 * Put both HTML and plain text on the clipboard, so italics survive a paste into a word
 * processor and plain editors get clean text. Falls back to text where the platform can't
 * write HTML. Returns which was written.
 */
export async function copyFormatted(
	clipboard: RichClipboard,
	f: Formatted,
	makeItem: ((data: Record<string, Blob>) => ClipboardItem) | undefined = typeof ClipboardItem === "undefined" ? undefined : (d) => new ClipboardItem(d)
): Promise<"html" | "text"> {
	if (clipboard.write && makeItem) {
		try {
			await clipboard.write([
				makeItem({
					"text/html": new Blob([f.html], { type: "text/html" }),
					"text/plain": new Blob([f.text], { type: "text/plain" }),
				}),
			]);
			return "html";
		} catch {
			// Some platforms refuse text/html; plain text still works.
		}
	}
	await clipboard.writeText(f.text);
	return "text";
}
