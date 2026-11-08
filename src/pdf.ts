import { App, TFile, loadPdfJs } from "obsidian";

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
	const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
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
