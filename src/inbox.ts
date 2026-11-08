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
			new Notice(`Reference Library: no URL found in ${file.name}; left in the inbox.`);
			return null;
		}
		const data = await lookup(this.fetch, { kind: "url", value: url }, { crossrefMailto: s.crossrefMailto });
		if (data) {
			const dup = this.library.findExisting(data, file);
			if (dup) {
				new Notice(`Reference Library: ${file.name} matches existing ${dup.basename}; left in the inbox.`);
				return null;
			}
		}
		// Make sure the URL ends up in the configured url property even if the clipper used "source".
		const basis: ReferenceData | null = data
			? { ...data, url: data.url ?? url }
			: { type: "webpage", title: String(fm.title ?? file.basename), authors: [], familyNames: [], url, source: "note" };
		const moved = await this.library.complete(file, basis, s.clipStatus);
		new Notice(`Reference Library: filed ${moved.basename}`);
		return moved;
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
		if (data) {
			const dup = this.library.findExisting(data);
			if (dup) {
				await this.library.attach(dup, file);
				new Notice(`Reference Library: attached ${file.name} to existing ${dup.basename}`);
				return dup;
			}
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
		const note = await this.library.create(data, s.defaultStatus);
		await this.library.attach(note, file);
		new Notice(`Reference Library: created ${note.basename} from ${data.source}`);
		return note;
	}
}
