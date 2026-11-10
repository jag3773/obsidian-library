/**
 * Batch actions on reference notes in the vault: which notes a scope covers, the preview of
 * an action, and running it one note at a time. The property logic is in batch.ts (pure).
 */

import { App, TFile, TFolder } from "obsidian";
import { BatchAction, BatchPlan, Same, applyToFrontmatter, linkTarget, linkedFrom, linkingTo, planBatch, propertySkipReason, sameLinkTarget } from "./batch";
import { Library } from "./library";
import { Fetcher } from "./metadata/http";
import { lookup } from "./metadata/lookup";
import { LibrarySettings } from "./settings";
import { NetworkTracker } from "./sync";
import { asText } from "./text";

/** A named set of notes a batch can act on. Shown in the preview so the scope is never hidden. */
export interface BatchScope {
	label: string;
	files: () => TFile[];
}

export class BatchActions {
	constructor(
		private app: App,
		private library: Library,
		private settings: () => LibrarySettings,
		private fetch: Fetcher,
		/** Mark a path as written by the plugin, so its own handlers don't react. */
		private settle: (path: string) => void
	) {}

	private props() {
		return { status: this.library.prop("status"), collections: this.library.prop("collections") };
	}

	/** Two links are the same collection when they resolve to the same note, or name the same one. */
	private sameFrom(note: TFile): Same {
		const dest = (v: unknown) => {
			const target = linkTarget(v);
			return target ? this.app.metadataCache.getFirstLinkpathDest(target, note.path) : null;
		};
		return (a, b) => {
			const x = dest(a);
			const y = dest(b);
			return x && y ? x === y : sameLinkTarget(a, b);
		};
	}

	// ------------------------------------------------------------ scopes

	/** Every reference note. */
	allReferences(): BatchScope {
		return { label: `All references in ${this.settings().referencesFolder}`, files: () => this.library.referenceFiles() };
	}

	/** Reference notes in a folder and its subfolders. */
	inFolder(folder: TFolder): BatchScope {
		return {
			label: `References in ${folder.path}`,
			files: () => this.library.referenceFiles().filter((f) => this.library.inFolder(f, folder.path)),
		};
	}

	/** Reference notes the note links to (body links and links in properties). */
	linkedFrom(note: TFile): BatchScope {
		return { label: `References linked from ${note.basename}`, files: () => this.resolve(linkedFrom(this.app.metadataCache.resolvedLinks, note.path)) };
	}

	/** Reference notes that link to the note, such as the members of a collection note. */
	linkingTo(note: TFile): BatchScope {
		return { label: `References linking to ${note.basename}`, files: () => this.resolve(linkingTo(this.app.metadataCache.resolvedLinks, note.path)) };
	}

	/** A fixed list of files, such as a selection or the rows of a Base view. */
	fixed(label: string, files: TFile[]): BatchScope {
		return { label, files: () => files };
	}

	private resolve(paths: string[]): TFile[] {
		return paths
			.map((p) => this.app.vault.getAbstractFileByPath(p))
			.filter((f): f is TFile => f instanceof TFile && this.library.isReference(f));
	}

	// ------------------------------------------------------------ preview and run

	/** What the action would do to each file, before anything is written. */
	plan(files: TFile[], action: BatchAction): BatchPlan<TFile> {
		return planBatch(files, (f) => this.skipReason(f, action));
	}

	skipReason(file: TFile, action: BatchAction): string | undefined {
		if (!this.library.isReference(file)) return "not in the references folder";
		switch (action.kind) {
			case "status":
			case "add-collection":
			case "remove-collection":
				return propertySkipReason(this.library.frontmatter(file), action, this.props(), this.sameFrom(file));
			case "regenerate-citekey":
				return undefined;
			case "complete": {
				if (this.library.identifierOf(file)) return undefined;
				const title = asText(this.library.frontmatter(file)[this.library.prop("title")]).trim();
				return title ? undefined : "no ISBN, DOI, URL or title";
			}
		}
	}

	/**
	 * Run the action on one file. Returns whether it changed the note; throws with a readable
	 * message when it can't. The preview's reasons are checked again, since notes can change
	 * while a long batch runs.
	 */
	async apply(file: TFile, action: BatchAction): Promise<boolean> {
		if (!this.library.exists(file)) throw new Error("no longer in the vault");
		const skip = this.skipReason(file, action);
		if (skip) return false;
		// The plugin may have been unloaded while the batch ran; stop before writing.
		this.library.assertActive();
		this.settle(file.path);
		try {
			switch (action.kind) {
				case "status":
				case "add-collection":
				case "remove-collection": {
					let changed = false;
					const same = this.sameFrom(file);
					await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
						// processFrontMatter runs this later; throwing here leaves the note unwritten.
						this.library.assertActive();
						changed = applyToFrontmatter(fm, action, this.props(), same);
					});
					return changed;
				}
				case "regenerate-citekey": {
					const before = { key: this.library.citekeyOf(file), path: file.path };
					const key = await this.library.exclusive(() => this.library.regenerateCitekey(file));
					return key !== before.key || file.path !== before.path;
				}
				case "complete":
					return await this.complete(file);
			}
		} finally {
			this.settle(file.path);
		}
	}

	/** Fill and rename one note from its identifier, or from its own properties without one. */
	private async complete(file: TFile): Promise<boolean> {
		const s = this.settings();
		const id = this.library.identifierOf(file);
		if (!id) {
			await this.library.exclusive(() => this.library.complete(file, null, s.defaultStatus));
			return true;
		}
		const net = new NetworkTracker();
		const data = await lookup(net.wrap(this.fetch), id, { crossrefMailto: s.crossrefMailto });
		if (!data) throw new Error(net.unreachable ? "couldn't reach the network" : `nothing found for ${id.value}`);
		await this.library.exclusive(async () => {
			if (!this.library.exists(file)) throw new Error("no longer in the vault");
			// The note may have been moved out of the references folder or given another identifier while this looked up.
			const now = this.library.identifierOf(file);
			if (!this.library.isReference(file) || now?.kind !== id.kind || now.value !== id.value) throw new Error("changed during lookup");
			await this.library.complete(file, data, s.defaultStatus);
		});
		return true;
	}
}
