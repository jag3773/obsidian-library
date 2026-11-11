// Small valid PDFs for the end-to-end tests, built with the same writer the unit tests use.
import { buildPdf } from "../../pdf-fixture";

/** A one-page PDF whose text layer holds the given lines (e.g. a DOI). */
export function pdfWithText(...lines: string[]): Uint8Array {
	return buildPdf([{ text: lines.map((text, i) => ({ x: 72, y: 720 - i * 18, text })) }]);
}
