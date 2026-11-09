import { ImportChoices, ImportPlan, planRecords } from "./importers/plan";
import { FILE_FORMAT_NAMES, FileFormat, detectFormat, parseFile } from "./importers/detect";
import { ReferenceImporter } from "./zoteroImport";

/**
 * Imports a CSL-JSON, BibTeX/BibLaTeX or RIS file (#17), with the same matching, preview,
 * report and undo as the Zotero import. A repeat import of the same file, or a newer one,
 * updates the notes the first one made.
 */
export class FileImporter extends ReferenceImporter {
	protected readonly kind = "Bibliography";

	/** The file's format and records; throws when it isn't one of the formats. */
	async read(path: string): Promise<{ format: FileFormat; text: string }> {
		const text = await this.readText(path, "Put the bibliography file in your vault and choose it.");
		const format = detectFormat(path, text);
		if (format === "zotero") throw new Error(`${path} is a Better BibTeX JSON export. Use Import from Zotero, which also reads its collections.`);
		if (!format) throw new Error(`${path} isn't CSL-JSON, BibTeX or RIS.`);
		return { format, text };
	}

	async plan(choices: ImportChoices): Promise<{ plan: ImportPlan; collections: string[]; format: FileFormat }> {
		const { format, text } = await this.read(choices.exportPath);
		let parsed;
		try {
			parsed = parseFile(format, text);
		} catch (e) {
			throw new Error(`${choices.exportPath}: ${e instanceof Error ? e.message : String(e)}`);
		}
		const path = choices.exportPath.trim();
		const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		const plan = planRecords(parsed.records, await this.vaultNotes(), this.options(choices, folder), {
			name: FILE_FORMAT_NAMES[format],
			library: false,
			diagnostics: parsed.diagnostics,
		});
		return { plan, collections: plan.report.collections, format };
	}
}
