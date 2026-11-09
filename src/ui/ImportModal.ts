import { App, Modal, Notice, Setting } from "obsidian";
import { CollectionRule, ImportChoices, ImportPlan, parseTagRules } from "../zotero";
import { ZoteroImporter } from "../zoteroImport";
import { PathSuggest, filePaths } from "./PathSuggest";

const ruleValue = (r: CollectionRule | undefined) => (!r || r.kind === "collection" ? "collection" : r.kind === "drop" ? "drop" : `status:${r.status}`);
const ruleFrom = (v: string): CollectionRule => (v === "drop" ? { kind: "drop" } : v.startsWith("status:") ? { kind: "status", status: v.slice(7) } : { kind: "collection" });

/**
 * Import a Better BibTeX JSON export: choose the file, decide what collections and tags
 * mean, preview the counts (a dry run), then import.
 */
export class ImportModal extends Modal {
	private collections: string[] = [];
	private plan: ImportPlan | null = null;
	private busy = false;

	constructor(
		app: App,
		private importer: ZoteroImporter,
		private choices: ImportChoices,
		private statuses: string[],
		private save: () => Promise<void>,
		private onImported: (reportPath: string, backupPath: string) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Import from Zotero");
		void this.render();
	}

	private async render(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		const c = this.choices;
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "In Zotero, choose File → Export Library… with the Better BibTeX JSON format, and save the file in your vault. Notes keep their bodies; the import adds properties, and nothing in Zotero is changed.",
		});
		new Setting(contentEl)
			.setName("Export file")
			.addSearch((t) => {
				new PathSuggest(this.app, t.inputEl, () => filePaths(this.app, ["json"]));
				t.setPlaceholder("zotero-export.json")
					.setValue(c.exportPath)
					.onChange((v) => {
						c.exportPath = v.trim();
						this.plan = null;
					});
			})
			.addButton((b) => b.setButtonText("Read").onClick(() => void this.readCollections()));

		if (this.collections.length) {
			new Setting(contentEl).setName("Collections").setHeading().setDesc("Keep a collection as a link in the collections property, drop it, or make it a reading status.");
			for (const name of this.collections) {
				new Setting(contentEl).setName(name).addDropdown((d) => {
					d.addOption("collection", "Keep as collection").addOption("drop", "Drop");
					for (const s of this.statuses) d.addOption(`status:${s}`, `Status: ${s}`);
					d.setValue(ruleValue(c.collections[name])).onChange((v) => {
						c.collections[name] = ruleFrom(v);
						this.plan = null;
					});
				});
			}
		}

		new Setting(contentEl).setName("Tags").setHeading();
		new Setting(contentEl)
			.setName("Tags that become properties")
			.setDesc('One per line, "tag = property: value". A * at the end matches the start of a tag. Rules for the status property are listed in priority order. Other tags are kept as tags.')
			.addTextArea((t) => {
				t.setPlaceholder("Own = owned: true\n_reviewing = status: reviewing\nReviewed-in-* = status: processed")
					.setValue(c.tagRules)
					.onChange((v) => {
						c.tagRules = v;
						this.plan = null;
					});
				t.inputEl.rows = 4;
				t.inputEl.addClass("stacks-input");
			});
		this.toggle(contentEl, "Keep automatic tags", "Tags Zotero added from catalogs and feeds, not only the ones you added.", "automaticTags");

		new Setting(contentEl).setName("Status").setHeading();
		const statusDropdown = (name: string, desc: string, key: "fallbackStatus" | "annotatedStatus") =>
			new Setting(contentEl)
				.setName(name)
				.setDesc(desc)
				.addDropdown((d) => {
					d.addOption("", "None");
					for (const s of this.statuses) d.addOption(s, s);
					d.setValue(c[key]).onChange((v) => {
						c[key] = v;
						this.plan = null;
					});
				});
		statusDropdown("Notes with highlights", "Notes that already have annotations get this status, even if a collection says otherwise.", "annotatedStatus");
		statusDropdown("Everything else", "For items no rule gives a status.", "fallbackStatus");

		new Setting(contentEl).setName("Options").setHeading();
		this.toggle(contentEl, "Create notes for items without one", "A note with the title, abstract and any Zotero notes.", "createMissing");
		this.toggle(contentEl, "Rename notes to current citekeys", "When a note's filename is an older citekey. Links update. Off: the report lists them.", "renameToCurrentKeys");
		this.toggle(contentEl, "Zotero's values win", "Replace bibliographic values a note already has. Off: only empty properties are filled.", "zoteroWins");

		const summary = contentEl.createDiv();
		if (this.plan) this.showSummary(summary, this.plan);
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Preview").onClick(() => void this.preview()))
			.addButton((b) =>
				b
					.setButtonText("Import")
					.setCta()
					.setDisabled(!this.plan)
					.onClick(() => void this.run())
			);
	}

	private toggle(el: HTMLElement, name: string, desc: string, key: "automaticTags" | "createMissing" | "renameToCurrentKeys" | "zoteroWins"): void {
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addToggle((t) =>
				t.setValue(this.choices[key]).onChange((v) => {
					this.choices[key] = v;
					this.plan = null;
				})
			);
	}

	private async readCollections(): Promise<void> {
		try {
			const exp = await this.importer.readExport(this.choices.exportPath);
			this.collections = [...new Set(Object.values(exp.collections ?? {}).map((c) => c.name))].sort();
			await this.save();
			await this.render();
		} catch (e) {
			new Notice(`Stacks: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private async preview(): Promise<void> {
		const { errors } = parseTagRules(this.choices.tagRules);
		if (errors.length) {
			new Notice(`Stacks: ${errors.join("; ")}`);
			return;
		}
		try {
			const { plan, exp } = await this.importer.plan(this.choices);
			if (!this.collections.length) this.collections = [...new Set(Object.values(exp.collections ?? {}).map((c) => c.name))].sort();
			this.plan = plan;
			await this.save();
			await this.render();
		} catch (e) {
			new Notice(`Stacks: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private showSummary(el: HTMLElement, plan: ImportPlan): void {
		const r = plan.report;
		el.createEl("h4", { text: "Preview" });
		const list = el.createEl("ul");
		const line = (text: string, n: number) => n && list.createEl("li", { text: `${n} ${text}` });
		line("items in the export", r.items);
		line("notes to update", plan.updates.length);
		for (const [by, n] of Object.entries(r.matched)) line(`matched by ${by}`, n);
		line("notes to create", plan.creates.length);
		line("notes to rename to their current citekey", r.keyChanges.filter((k) => k.renamed).length);
		line("citekey changes left as they are", r.keyChanges.filter((k) => !k.renamed).length);
		line("duplicates in Zotero (not created)", r.zoteroDuplicates.length);
		line("duplicate notes to merge by hand", r.duplicateNotes.length);
		line("notes from a group library (left alone)", r.groupNotes.length);
		line("notes whose Zotero item isn't in the export", r.missingFromExport.length);
		line("notes with broken frontmatter to repair", r.repairedNotes.length);
		line("attachments outside the vault", r.attachmentsNotInVault.length);
		el.createEl("p", { cls: "setting-item-description", text: "Importing writes a report note with every list, and a backup so Stacks: Undo last Zotero import can reverse it." });
	}

	private async run(): Promise<void> {
		if (!this.plan || this.busy) return;
		this.busy = true;
		const plan = this.plan;
		this.close();
		const progress = new Notice("Stacks: importing…", 0);
		try {
			const backup = await this.importer.apply(plan, this.choices, (done, total) => {
				if (done % 50 === 0 || done === total) progress.setMessage(`Stacks: importing… ${done} of ${total}`);
			});
			this.onImported(backup.reportPath, this.importer.lastBackup);
		} catch (e) {
			new Notice(`Stacks: import stopped. ${e instanceof Error ? e.message : String(e)} Run Undo last Zotero import to reverse what was written.`);
		} finally {
			progress.hide();
			this.busy = false;
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
