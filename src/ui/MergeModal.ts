import { App, ButtonComponent, Modal, Notice, Setting, TFile } from "obsidian";
import { DuplicateGroup, describeReason, preferredKeeper } from "../duplicates";
import { Library } from "../library";
import { Maintenance, MergePlan } from "../maintenance";
import { asText } from "../text";

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
const show = (v: unknown) => (Array.isArray(v) ? v.map(asText).join(", ") : asText(v));

/** The duplicate groups found, each with why it matched and a button to review a merge. */
export class DuplicatesModal extends Modal {
	constructor(
		app: App,
		private groups: DuplicateGroup[],
		private onReview: (group: DuplicateGroup) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle("Duplicate references");
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "Notes with the same DOI, ISBN or URL, or the same title and year. Exact matches only; nothing is merged without a preview.",
		});
		for (const g of this.groups) {
			new Setting(contentEl)
				.setName(g.paths.map(nameOf).join(", "))
				.setDesc(g.pairs.map((p) => (g.paths.length > 2 ? `${nameOf(p.a)} and ${nameOf(p.b)}: ` : "") + p.reasons.map(describeReason).join("; ")).join(". "))
				.addButton((b) =>
					b.setButtonText("Review").onClick(() => {
						this.close();
						this.onReview(g);
					})
				);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Merge one group of duplicates: choose the note to keep, see what each other note's merge
 * changes, then merge. The kept note defaults to the one whose filename is its citekey.
 */
export class MergeModal extends Modal {
	private keep: string;
	/** The plans for the current note to keep; empty until its preview is in. */
	private plans: MergePlan[] = [];
	private mergeButton?: ButtonComponent;
	private busy = false;
	/** Counts choices of note to keep, so a preview for an earlier choice is ignored. */
	private request = 0;

	constructor(
		app: App,
		private library: Library,
		private maintenance: Maintenance,
		private group: DuplicateGroup
	) {
		super(app);
		const notes = group.paths
			.map((p) => app.vault.getAbstractFileByPath(p))
			.filter((f): f is TFile => f instanceof TFile)
			.map((f) => ({ path: f.path, basename: f.basename, frontmatter: library.frontmatter(f) }));
		this.keep = preferredKeeper(notes, library.prop("citekey")) ?? "";
	}

	onOpen(): void {
		this.setTitle("Merge duplicate references");
		void this.render();
	}

	private files(): TFile[] {
		return this.group.paths.map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f): f is TFile => f instanceof TFile);
	}

	private async render(): Promise<void> {
		const { contentEl } = this;
		const files = this.files();
		const keep = files.find((f) => f.path === this.keep);
		const request = ++this.request;
		// Until this choice's preview is in, the previous plan can't be merged.
		this.plans = [];
		this.mergeButton?.setDisabled(true);
		const plans = keep ? await Promise.all(files.filter((f) => f !== keep).map((f) => this.maintenance.planMerge(keep, f))) : [];
		// A newer choice of note to keep is already rendering.
		if (request !== this.request) return;
		this.plans = plans;
		contentEl.empty();
		for (const pair of this.group.pairs)
			contentEl.createEl("p", { text: `${nameOf(pair.a)} and ${nameOf(pair.b)}: ${pair.reasons.map(describeReason).join("; ")}.` });
		if (files.length < 2) {
			contentEl.createEl("p", { text: "These notes were moved or deleted. Nothing to merge." });
			return;
		}

		new Setting(contentEl)
			.setName("Note to keep")
			.setDesc(keep ? "The other notes merge into it, then move to the trash." : "None of these notes is named after its own citekey, so choose one.")
			.addDropdown((d) => {
				if (!keep) d.addOption("", "Choose a note");
				for (const f of files) d.addOption(f.path, f.basename);
				d.setValue(this.keep).onChange((v) => {
					this.keep = v;
					void this.render();
				});
			});
		if (!keep) return;

		for (const plan of this.plans) {
			new Setting(contentEl).setName(`${plan.drop.basename} into ${keep.basename}`).setHeading();
			const list = contentEl.createEl("ul");
			const item = (text: string) => list.createEl("li", { text });
			const links = plan.links.reduce((n, l) => n + l.count, 0);
			item(links ? `${links} ${links === 1 ? "link" : "links"} in ${plan.links.length} ${plan.links.length === 1 ? "note" : "notes"} will point to ${keep.basename}.` : `No links to ${plan.drop.basename}.`);
			for (const c of plan.changes)
				item(c.kind === "union" ? `${c.property}: adds ${show(c.added)}` : `${c.property}: fills in ${show(c.added)}`);
			if (plan.annotationsCopied) item(`Its annotations block is copied into ${keep.basename}, which has none.`);
			if (plan.paragraphsAdded)
				item(`${plan.paragraphsAdded} ${plan.paragraphsAdded === 1 ? "paragraph" : "paragraphs"} only it has go under "Merged from ${plan.drop.basename}".`);
			const key = asText(this.library.frontmatter(plan.drop)[this.library.prop("citekey")]).trim();
			if (key) item(`Citations written as [@${key}] in your drafts aren't changed.`);
			item(`${plan.drop.basename} moves to the trash.`);
		}

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => {
				this.mergeButton = b;
				b.setButtonText("Merge")
					.setCta()
					.onClick(() => void this.merge());
			});
	}

	private async merge(): Promise<void> {
		const plans = this.plans;
		if (this.busy || !plans.length || plans[0].keep.path !== this.keep) return;
		this.busy = true;
		let links = 0;
		let notes = 0;
		let merged = 0;
		try {
			for (const plan of plans) {
				const r = await this.maintenance.merge(plan);
				links += r.linksChanged;
				notes += r.filesChanged;
				merged++;
			}
			new Notice(`Stacks: merged ${merged} ${merged === 1 ? "note" : "notes"} into ${plans[0].keep.basename}; ${links} ${links === 1 ? "link" : "links"} in ${notes} ${notes === 1 ? "note" : "notes"} now point to it.`);
		} catch (e) {
			console.error("[Stacks]", e);
			new Notice(`Stacks: merge stopped after ${merged} of ${plans.length}. ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			this.busy = false;
			this.close();
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
