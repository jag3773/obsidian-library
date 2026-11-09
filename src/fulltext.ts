import { App, Notice, TFile } from "obsidian";
import { normalizeDoi } from "./identifiers";
import { Library } from "./library";
import { PdfCandidate, PdfSearch, describeCandidate, downloadPdf, findPdfCandidates } from "./metadata/fulltext";
import { Fetcher } from "./metadata/http";
import { LibrarySettings } from "./settings";
import { asText } from "./text";

/** Asks which candidate to download; null cancels. */
export type ChooseCandidate = (note: TFile, search: PdfSearch) => Promise<PdfCandidate | null>;

/**
 * The Find PDF command: look for an open-access PDF of a reference, confirm the source with
 * the person, download it, check it is a PDF, and attach it. Never runs on its own.
 */
export class FullText {
	constructor(
		private app: App,
		private library: Library,
		private fetch: Fetcher,
		private settings: () => LibrarySettings,
		private choose: ChooseCandidate
	) {}

	/** The note's pdf link, if it has one. */
	private existingPdf(note: TFile): string {
		return asText(this.library.frontmatter(note)[this.library.prop("pdf")]).trim();
	}

	/** Find, confirm, download and attach. Returns the new attachment, or null. */
	async find(note: TFile): Promise<TFile | null> {
		const existing = this.existingPdf(note);
		if (existing) {
			new Notice(`Stacks: ${note.basename} already has a PDF (${existing}). Remove its ${this.library.prop("pdf")} property first to look for another.`);
			return null;
		}
		const fm = this.library.frontmatter(note);
		const doi = normalizeDoi(asText(fm[this.library.prop("doi")])) ?? undefined;
		const url = asText(fm[this.library.prop("url")]).trim() || undefined;
		const email = this.settings().crossrefMailto.trim();
		if (!doi && !url) {
			new Notice(`Stacks: ${note.basename} has no DOI or URL to look for a PDF with.`);
			return null;
		}
		if (!doi && !email) {
			// Only the landing page can be tried; say why Unpaywall isn't.
			new Notice("Stacks: without a DOI only the note's web page is checked. Unpaywall needs a DOI and a contact email (Settings → Lookups).");
		}
		const pending = new Notice(`Stacks: looking for a PDF of ${note.basename}…`, 0);
		let search: PdfSearch;
		try {
			search = await findPdfCandidates(this.fetch, { doi, url }, email);
		} finally {
			pending.hide();
		}
		if (!search.candidates.length) {
			new Notice(`Stacks: no PDF found for ${note.basename}. ${search.notes.join(" ")} You can always attach your own copy.`, 10_000);
			return null;
		}
		const chosen = await this.choose(note, search);
		if (!chosen) return null;
		const downloading = new Notice(`Stacks: downloading from ${describeCandidate(chosen)}…`, 0);
		let result: Awaited<ReturnType<typeof downloadPdf>>;
		try {
			result = await downloadPdf(this.fetch, chosen.url);
		} finally {
			downloading.hide();
		}
		if ("error" in result) {
			new Notice(`Stacks: couldn't get a PDF from ${describeCandidate(chosen)}: ${result.error}. Nothing was saved.`, 10_000);
			return null;
		}
		const bytes = result.bytes;
		return this.library.exclusive(async () => {
			// The note may have been deleted, or given a PDF, while this downloaded.
			if (!this.library.exists(note)) return null;
			const now = this.existingPdf(note);
			if (now) {
				new Notice(`Stacks: ${note.basename} got a PDF (${now}) meanwhile; the download was not saved.`);
				return null;
			}
			const file = await this.library.attachNew(note, bytes, "pdf");
			new Notice(`Stacks: saved ${file.name} from ${describeCandidate(chosen)}.`);
			return file;
		});
	}
}
