/** Pure module: which bibliography format a file is, and its records. */
import { parseBibtex } from "./bibtex";
import { parseCslJson } from "./csljson";
import { ParseResult } from "./record";
import { parseRis } from "./ris";

export type FileFormat = "csl-json" | "bibtex" | "ris";

export const FILE_FORMAT_NAMES: Record<FileFormat, string> = { "csl-json": "CSL-JSON", bibtex: "BibTeX", ris: "RIS" };

/** Extensions offered when choosing a file. */
export const IMPORT_EXTENSIONS = ["json", "bib", "biblatex", "bibtex", "ris", "txt"];

/**
 * The format, from the content first (an exported file is often named .txt) and then the
 * extension. A Better BibTeX JSON export is recognized so it can be sent to the Zotero import.
 */
export function detectFormat(path: string, text: string): FileFormat | "zotero" | undefined {
	const t = text.replace(/^\uFEFF/, "").trimStart();
	if (t.startsWith("[") || t.startsWith("{")) {
		if (t.startsWith("{") && /"items"\s*:\s*\[/.test(t) && /"itemType"\s*:/.test(t)) return "zotero";
		return "csl-json";
	}
	if (/^TY\s{1,2}-/m.test(t)) return "ris";
	if (/^\s*@[a-zA-Z]+\s*[{(]/m.test(t)) return "bibtex";
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	if (ext === "json") return "csl-json";
	if (ext === "bib" || ext === "biblatex" || ext === "bibtex") return "bibtex";
	if (ext === "ris") return "ris";
	return undefined;
}

export function parseFile(format: FileFormat, text: string): ParseResult {
	return format === "csl-json" ? parseCslJson(text) : format === "bibtex" ? parseBibtex(text) : parseRis(text);
}
