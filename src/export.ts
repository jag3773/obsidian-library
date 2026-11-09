import { App, DataAdapter, normalizePath } from "obsidian";
import { BibFormat, Bibliography, BibSource, buildBibliography, parseFilter, render } from "./bibliography";
import { Library } from "./library";
import { LibrarySettings } from "./settings";

export interface ExportResult extends Bibliography {
	path: string;
	format: BibFormat;
	/** False when the file already held exactly this bibliography. */
	written: boolean;
}

/**
 * Write a file so readers never see it half-written: write a hidden temporary file beside
 * it, then rename it over the target. Where the platform won't rename over an existing file,
 * fall back to one direct write. Returns false, without writing, when the content is unchanged.
 */
export async function writeAtomic(adapter: DataAdapter, path: string, data: string): Promise<boolean> {
	const target = normalizePath(path);
	if ((await adapter.exists(target)) && (await adapter.read(target)) === data) return false;
	const slash = target.lastIndexOf("/");
	const dir = slash >= 0 ? target.slice(0, slash + 1) : "";
	// A dot-file, so Obsidian doesn't index the temporary copy.
	const tmp = `${dir}.${target.slice(slash + 1)}.library-tmp`;
	await adapter.write(tmp, data);
	try {
		await adapter.rename(tmp, target);
	} catch {
		await adapter.write(target, data);
		await adapter.remove(tmp).catch(() => undefined);
	}
	return true;
}

/** Bibliographies from the reference notes in the vault. */
export class BibliographyExporter {
	constructor(
		private app: App,
		private library: Library,
		private settings: () => LibrarySettings
	) {}

	/** Reference notes as export sources; `files` limits them to a selection. */
	sources(files = this.library.referenceFiles()): BibSource[] {
		return files.map((f) => ({ path: f.path, frontmatter: this.library.frontmatter(f) }));
	}

	build(files?: Parameters<BibliographyExporter["sources"]>[0], filterText = this.settings().exportFilter): Bibliography {
		return buildBibliography(this.sources(files), this.settings().propertyNames, parseFilter(filterText));
	}

	/** Export the library (filtered by the settings) to the configured file. */
	async export(path = this.settings().exportPath, format = this.settings().exportFormat): Promise<ExportResult> {
		const target = normalizePath(path.trim());
		if (!target || target === "/") throw new Error("Set a bibliography file in the Stacks settings first.");
		const bib = this.build();
		const slash = target.lastIndexOf("/");
		if (slash > 0) await this.library.ensureFolder(target.slice(0, slash));
		const written = await writeAtomic(this.app.vault.adapter, target, render(bib.items, format));
		return { ...bib, path: target, format, written };
	}
}
