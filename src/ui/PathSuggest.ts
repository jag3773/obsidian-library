import { AbstractInputSuggest, App, TFile, TFolder } from "obsidian";

/**
 * Type-ahead for a settings text box, listing vault paths that contain what's typed.
 * Choosing a suggestion fills the box and fires its normal "input" event, so the setting's
 * existing onChange handler saves it.
 */
export class PathSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private input: HTMLInputElement,
		private paths: () => string[]
	) {
		super(app, input);
	}

	protected getSuggestions(query: string): string[] {
		const q = query.trim().toLowerCase();
		const all = this.paths();
		if (!q) return all;
		// Prefix matches first, then matches anywhere in the path.
		const starts = all.filter((p) => p.toLowerCase().startsWith(q));
		const contains = all.filter((p) => !p.toLowerCase().startsWith(q) && p.toLowerCase().includes(q));
		return [...starts, ...contains];
	}

	renderSuggestion(path: string, el: HTMLElement): void {
		el.setText(path);
	}

	selectSuggestion(path: string): void {
		this.setValue(path);
		this.input.dispatchEvent(new Event("input"));
		this.close();
	}
}

/** Every folder in the vault except the root, sorted. */
export function folderPaths(app: App): string[] {
	return app.vault
		.getAllLoadedFiles()
		.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
		.map((f) => f.path)
		.sort((a, b) => a.localeCompare(b));
}

/** Every file with one of the given extensions, sorted. */
export function filePaths(app: App, extensions: string[]): string[] {
	return app.vault
		.getFiles()
		.filter((f: TFile) => extensions.includes(f.extension))
		.map((f) => f.path)
		.sort((a, b) => a.localeCompare(b));
}
