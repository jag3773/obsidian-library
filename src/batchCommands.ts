/**
 * Commands, menus and the Bases view for batch edits and the library base. Kept out of
 * main.ts, which only calls registerBatchCommands().
 */

import { Menu, Notice, TAbstractFile, TFile, TFolder, normalizePath, stringifyYaml } from "obsidian";
import { BatchAction } from "./batch";
import { BatchActions, BatchScope } from "./batchActions";
import { starterBase } from "./bases";
import type LibraryPlugin from "./main";
import { Fetcher } from "./metadata/http";
import { BATCH_VIEW_TYPE, batchViewFactory } from "./ui/BatchBaseView";
import { BatchModal } from "./ui/BatchModal";

export function registerBatchCommands(plugin: LibraryPlugin, fetcher: Fetcher, settle: (path: string) => void): BatchActions {
	const { app } = plugin;
	const batch = new BatchActions(app, plugin.library, () => plugin.settings, fetcher, settle);

	const open = (scopes: BatchScope[], collection?: string) =>
		new BatchModal(app, batch, scopes, {
			statuses: plugin.settings.statuses,
			collection,
			warning: (action: BatchAction) => {
				const send = plugin.settings.sendStatus.trim();
				if (action.kind !== "status" || !send || action.value !== send || !plugin.roundTrip?.folder()) return null;
				return `Setting the status to ${send} also sends each note's PDF to the tablet folder.`;
			},
		}).open();

	plugin.addCommand({
		id: "batch-edit",
		name: "Batch edit references",
		callback: () => {
			const active = app.workspace.getActiveFile();
			const scopes: BatchScope[] = [];
			let collection: string | undefined;
			if (active?.extension === "md" && !plugin.library.isReference(active)) {
				// A collection or project note: its members link to it, and it may list sources itself.
				scopes.push(batch.linkingTo(active), batch.linkedFrom(active));
				collection = `[[${app.metadataCache.fileToLinktext(active, "", true)}]]`;
			} else if (active && plugin.library.isReference(active)) {
				scopes.push(batch.fixed(`Only ${active.basename}`, [active]));
			}
			scopes.push(batch.allReferences());
			open(scopes, collection);
		},
	});
	plugin.addCommand({ id: "create-library-base", name: "Create library base", callback: () => void createLibraryBase(plugin) });

	// Notes selected in the file explorer, and folders.
	plugin.registerEvent(
		app.workspace.on("files-menu", (menu: Menu, files: TAbstractFile[]) => {
			const refs = files.filter((f): f is TFile => f instanceof TFile && plugin.library.isReference(f));
			if (!refs.length) return;
			menu.addItem((item) =>
				item
					.setTitle(`Batch edit ${refs.length} ${refs.length === 1 ? "reference" : "references"}`)
					.setIcon("list-checks")
					.onClick(() => open([batch.fixed(`${refs.length} selected in the file explorer`, refs)]))
			);
		})
	);
	plugin.registerEvent(
		app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
			if (!(file instanceof TFolder)) return;
			const scope = batch.inFolder(file);
			const refsFolder = normalizePath(plugin.settings.referencesFolder);
			// Only folders that are, or are inside or around, the references folder.
			if (file.path !== refsFolder && !file.path.startsWith(`${refsFolder}/`) && !refsFolder.startsWith(`${file.path}/`) && !file.isRoot()) return;
			menu.addItem((item) => item.setTitle("Batch edit references in this folder").setIcon("list-checks").onClick(() => open([scope])));
		})
	);

	// A Bases view whose rows Stacks can act on (Obsidian 1.10 and later, with Bases enabled).
	const factory = batchViewFactory((files) => open([batch.fixed(`${files.length} in this Base view`, files)]));
	if (factory && typeof plugin.registerBasesView === "function") {
		plugin.registerBasesView(BATCH_VIEW_TYPE, { name: "Stacks batch", icon: "list-checks", factory });
	}
	return batch;
}

/** Write a library base with the reading-workflow views. Never overwrites a file. */
export async function createLibraryBase(plugin: LibraryPlugin): Promise<TFile | null> {
	const { app } = plugin;
	const s = plugin.settings;
	let path = "Library.base";
	for (let i = 1; app.vault.getAbstractFileByPath(path); i++) path = `Library ${i}.base`;
	let file: TFile;
	try {
		file = await app.vault.create(path, stringifyYaml(starterBase(s.referencesFolder, s.propertyNames, s.statuses)));
	} catch (e) {
		new Notice(`Stacks: couldn't create ${path}: ${e instanceof Error ? e.message : String(e)}`);
		return null;
	}
	// Adopt it when no library base is set. Its folder and fields come from the settings, so nothing else changes.
	if (!s.libraryBase.trim()) {
		s.libraryBase = path;
		await plugin.saveSettings();
	}
	await app.workspace.getLeaf(false).openFile(file);
	new Notice(`Stacks: created ${path}.`);
	return file;
}
