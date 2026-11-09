import { App, TFile, loadPdfJs } from "obsidian";
import { ExtractResult, collectAnnotations } from "./annotations";

export interface PdfInfo {
	text: string;
	title?: string;
	author?: string;
}

/** Read the opening pages and document metadata with Obsidian's bundled PDF.js. */
export async function readPdf(app: App, file: TFile, pages = 3): Promise<PdfInfo> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const pdfjs: any = await loadPdfJs();
	const data = await app.vault.readBinary(file);
	// PDFs in the inbox may come from anywhere: disable eval-based font rendering (CVE-2024-4367)
	// and scripting.
	const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, enableScripting: false }).promise;
	try {
		const parts: string[] = [];
		for (let i = 1; i <= Math.min(pages, doc.numPages); i++) {
			const page = await doc.getPage(i);
			const content = await page.getTextContent();
			parts.push(content.items.map((it: { str?: string }) => it.str ?? "").join(" "));
		}
		const meta = await doc.getMetadata().catch(() => null);
		const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
		return { text: parts.join("\n"), title: info.Title?.trim() || undefined, author: info.Author?.trim() || undefined };
	} finally {
		await doc.destroy();
	}
}

/** A PDF the extractor can't read, with a reason fit to show the user. */
export class PdfReadError extends Error {
	constructor(
		message: string,
		public reason: "encrypted" | "unreadable"
	) {
		super(message);
		this.name = "PdfReadError";
	}
}

/** Open PDF bytes with PDF.js; turns PDF.js's exceptions into PdfReadError. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function openPdf(pdfjs: any, data: ArrayBuffer | Uint8Array, name: string): Promise<any> {
	try {
		// Copy: PDF.js transfers the buffer to its worker.
		const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
		return await pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableScripting: false, verbosity: 0 }).promise;
	} catch (e) {
		const n = (e as { name?: string })?.name;
		if (n === "PasswordException") throw new PdfReadError(`${name} is password-protected; remove the password to extract annotations.`, "encrypted");
		throw new PdfReadError(`${name} couldn't be read as a PDF (${e instanceof Error ? e.message : String(e)}).`, "unreadable");
	}
}

/** Read the annotations of a PDF with Obsidian's bundled PDF.js. */
export async function readAnnotations(data: ArrayBuffer | Uint8Array, name: string): Promise<ExtractResult> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const pdfjs: any = await loadPdfJs();
	const doc = await openPdf(pdfjs, data, name);
	try {
		return await collectAnnotations(doc);
	} finally {
		await doc.destroy();
	}
}
