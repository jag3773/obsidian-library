import { App, Notice, TFile, getFrontMatterInfo, parseYaml } from "obsidian";
import { familyFromFullName } from "./citekey";
import { findIdentifierInText } from "./identifiers";
import { Library } from "./library";
import { Fetcher } from "./metadata/http";
import { parseDate, yearOf } from "./metadata/dates";
import { lookup } from "./metadata/lookup";
import { ReferenceData } from "./metadata/types";
import { readPdf } from "./pdf";
import { PropertyKey } from "./properties";
import { LibrarySettings } from "./settings";

/** Handles files that land in the inbox folder. */
export class Inbox {
	constructor(
		private app: App,
		private library: Library,
		private fetch: Fetcher,
		private settings: () => LibrarySettings
	) {}

	accepts(file: TFile): boolean {
		const inbox = this.settings().inboxFolder.trim();
		// An empty inbox setting would match the whole vault, so treat it as "off".
		if (!inbox || inbox === "/") return false;
		return (file.extension === "md" || file.extension === "pdf") && this.library.inFolder(file, inbox);
	}

	/** Still in the inbox after a network wait (not moved, renamed out or deleted meanwhile). */
	private stillWaiting(file: TFile): boolean {
		return this.library.exists(file) && this.accepts(file);
	}

	async process(file: TFile): Promise<TFile | null> {
		if (file.extension === "md") return this.processNote(file);
		if (file.extension === "pdf") return this.processPdf(file);
		return null;
	}

	/** A clipped note: read its URL, enrich, set the clip status, file it. */
	async processNote(file: TFile): Promise<TFile | null> {
		const s = this.settings();
		const content = await this.app.vault.read(file);
		const info = getFrontMatterInfo(content);
		const fm = (info.exists ? parseYaml(info.frontmatter) : {}) ?? {};
		const url = s.urlProperties.map((k) => fm[k]).find((v) => typeof v === "string" && /^https?:\/\//i.test(v)) as string | undefined;
		if (!url) {
			new Notice(`Library: no URL found in ${file.name}; left in the inbox.`);
			return null;
		}
		const data = await lookup(this.fetch, { kind: "url", value: url }, { crossrefMailto: s.crossrefMailto });
		// Effective metadata: the lookup result with the clip's URL kept. What the clipper saved
		// (read in the browser, so it works on sites that block the plugin's request) fills any
		// gaps, or stands in when the lookup failed. The URL ends up in the configured url
		// property even if the clipper used "source".
		const clip = fromClip(fm, s.propertyNames, file.basename);
		const basis: ReferenceData = data ? fillFromClip({ ...data, url: data.url ?? url }, clip) : { ...clip, url };
		return this.library.exclusive(async () => {
			if (!this.stillWaiting(file)) return null;
			// Check the enriched identifiers and the clip's own URL, whether or not the lookup worked.
			const dup = this.library.findExisting(basis, file) ?? this.library.findExisting({ url }, file);
			if (dup) {
				new Notice(`Library: ${file.name} matches existing ${dup.basename}; left in the inbox.`);
				return null;
			}
			// The clip keeps the URL property it came from, so later captures of the same original
			// URL still match after the mapped url becomes the canonical one.
			const moved = await this.library.complete(file, basis, s.clipStatus, [url], !!data);
			new Notice(`Library: filed ${moved.basename}`);
			return moved;
		});
	}

	/** A PDF: find a DOI or ISBN inside, look it up, create the note, file the PDF. */
	async processPdf(file: TFile): Promise<TFile | null> {
		const s = this.settings();
		let data: ReferenceData | null = null;
		let pdfTitle: string | undefined;
		let pdfAuthor: string | undefined;
		try {
			const pdf = await readPdf(this.app, file);
			pdfTitle = pdf.title;
			pdfAuthor = pdf.author;
			const id = findIdentifierInText(pdf.text);
			if (id) data = await lookup(this.fetch, id, { crossrefMailto: s.crossrefMailto });
		} catch (e) {
			console.warn("[library] could not read PDF", file.path, e);
		}
		if (!data) {
			const authors = pdfAuthor ? pdfAuthor.split(/\s*(?:;|,| and )\s*/).filter(Boolean) : [];
			data = {
				type: "document",
				title: pdfTitle || file.basename,
				authors,
				familyNames: authors.map(familyFromFullName),
				source: "PDF",
			};
		}
		const found = data;
		// The note's frontmatter may not be indexed yet (new, or reserved by a concurrent
		// capture), so pass the naming values along; values already on the note win.
		const naming = { title: found.title, familyNames: found.familyNames, year: found.year };
		return this.library.exclusive(async () => {
			if (!this.stillWaiting(file)) return null;
			const dup = this.library.findExisting(found);
			if (dup) {
				await this.library.attach(dup, file, naming);
				new Notice(`Library: attached ${file.name} to existing ${dup.basename}`);
				return dup;
			}
			const note = await this.library.create(found, s.defaultStatus);
			await this.library.attach(note, file, naming);
			new Notice(`Library: created ${note.basename} from ${found.source}`);
			return note;
		});
	}
}

const str = (v: unknown): string =>
	typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : v instanceof Date && !isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : "";

/** Names in a property value: a list, a string of [[links]], or one plain name. */
function names(v: unknown): string[] {
	const items = Array.isArray(v) ? v.map(str) : [str(v)];
	return items
		.flatMap((item) => {
			const links = [...item.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) => m[1].trim());
			return links.length ? links : [item];
		})
		.filter(Boolean);
}

/**
 * Metadata a clipper already wrote into the note: under the library's property names, or
 * Web Clipper's defaults (title, author, published, description).
 */
export function fromClip(fm: Record<string, unknown>, props: Record<PropertyKey, string>, fallbackTitle: string): ReferenceData {
	const first = (...keys: string[]) => keys.map((k) => fm[k]).find((v) => (Array.isArray(v) ? v.length : str(v)));
	const authors = names(first(props.authors, "author", "authors", "creator"));
	const date = parseDate(str(first(props.published, "published", "date")) || undefined);
	return {
		type: "webpage",
		title: str(first(props.title, "title")) || fallbackTitle,
		authors,
		familyNames: authors.map(familyFromFullName),
		date,
		year: yearOf(date),
		abstract: str(first(props.abstract, "description", "abstract", "summary")) || undefined,
		source: "note",
	};
}

/** found, with empty authors, date and abstract taken from the clip. */
function fillFromClip(found: ReferenceData, clip: ReferenceData): ReferenceData {
	const out = { ...found };
	// A page without a title comes back titled with its URL; the clip's title is better.
	if (/^https?:\/\//i.test(out.title) && clip.title) out.title = clip.title;
	if (!out.authors.length && clip.authors.length) {
		out.authors = clip.authors;
		out.familyNames = clip.familyNames;
	}
	if (!out.date && clip.date) {
		out.date = clip.date;
		out.year ??= clip.year;
	}
	out.abstract ??= clip.abstract;
	return out;
}
