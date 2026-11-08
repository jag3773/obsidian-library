import { App, Notice, TFile, getFrontMatterInfo, parseYaml } from "obsidian";
import { familyFromFullName } from "./citekey";
import { findIdentifierInText } from "./identifiers";
import { Library } from "./library";
import { Fetcher } from "./metadata/http";
import { lookup } from "./metadata/lookup";
import { ReferenceData } from "./metadata/types";
import { readPdf } from "./pdf";
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
		// Effective metadata: the lookup result with the clip's URL kept, or a fallback when the
		// lookup failed (offline, HTTP error). The URL ends up in the configured url property
		// even if the clipper used "source".
		const basis: ReferenceData = data
			? { ...data, url: data.url ?? url }
			: { type: "webpage", title: String(fm.title ?? file.basename), authors: [], familyNames: [], url, source: "note" };
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
			const moved = await this.library.complete(file, basis, s.clipStatus, [url]);
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
			console.warn("[reference-library] could not read PDF", file.path, e);
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
