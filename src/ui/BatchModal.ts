import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { ACTION_LABELS, BatchAction, BatchKind, BatchResult, collectionLink, describeResult, runBatch } from "../batch";
import { BatchActions, BatchScope } from "../batchActions";
import { Cancelled } from "../library";

const LIST_LIMIT = 100;

export interface BatchModalOptions {
	statuses: string[];
	/** Prefilled collection, such as a link to the active note. */
	collection?: string;
	/** A caution to show for an action (e.g. a status that also sends PDFs to the tablet). */
	warning?: (action: BatchAction) => string | null;
}

/**
 * Batch edit: choose a scope and an action, preview exactly which notes change (and which
 * are left alone, and why), then apply one note at a time with progress, a stop button and
 * a report of anything that failed.
 */
export class BatchModal extends Modal {
	private scopeIndex = 0;
	private kind: BatchKind = "status";
	private status: string;
	private collection: string;
	private running = false;
	private stop = false;
	private closed = false;
	private previewEl!: HTMLElement;
	private formEl!: HTMLElement;

	constructor(
		app: App,
		private batch: BatchActions,
		private scopes: BatchScope[],
		private opts: BatchModalOptions
	) {
		super(app);
		this.status = opts.statuses[0] ?? "";
		this.collection = opts.collection ?? "";
	}

	private action(): BatchAction | null {
		switch (this.kind) {
			case "status":
				return this.status ? { kind: "status", value: this.status } : null;
			case "add-collection":
			case "remove-collection": {
				const link = collectionLink(this.collection);
				return link ? { kind: this.kind, link } : null;
			}
			default:
				return { kind: this.kind };
		}
	}

	onOpen(): void {
		this.setTitle("Batch edit references");
		this.formEl = this.contentEl.createDiv();
		this.previewEl = this.contentEl.createDiv();
		this.renderForm();
	}

	onClose(): void {
		// Closing stops a running batch after the note in progress.
		this.stop = true;
		this.closed = true;
		this.contentEl.empty();
	}

	private renderForm(): void {
		const el = this.formEl;
		el.empty();
		new Setting(el).setName("Notes").addDropdown((d) => {
			for (const [i, s] of this.scopes.entries()) d.addOption(String(i), s.label);
			d.setValue(String(this.scopeIndex)).onChange((v) => {
				this.scopeIndex = Number(v);
				this.renderPreview();
			});
		});
		new Setting(el).setName("Action").addDropdown((d) => {
			for (const [k, label] of Object.entries(ACTION_LABELS)) d.addOption(k, label);
			d.setValue(this.kind).onChange((v) => {
				this.kind = v as BatchKind;
				this.renderForm();
			});
		});
		if (this.kind === "status")
			new Setting(el).setName("Status").addDropdown((d) => {
				for (const s of this.opts.statuses) d.addOption(s, s);
				d.setValue(this.status).onChange((v) => {
					this.status = v;
					this.renderPreview();
				});
			});
		if (this.kind === "add-collection" || this.kind === "remove-collection")
			new Setting(el)
				.setName("Collection")
				.setDesc("A link to the collection's note, such as [[Climate]]. The note doesn't have to exist yet.")
				.addText((t) =>
					t
						.setPlaceholder("[[Climate]]")
						.setValue(this.collection)
						.onChange((v) => {
							this.collection = v;
							this.renderPreview();
						})
				);
		this.renderPreview();
	}

	private renderPreview(): void {
		const el = this.previewEl;
		el.empty();
		const scope = this.scopes[this.scopeIndex];
		const action = this.action();
		const files = scope ? scope.files() : [];
		if (!action) {
			el.createEl("p", { text: this.kind === "status" ? "Choose a status." : "Enter a collection.", cls: "setting-item-description" });
			return;
		}
		const plan = this.batch.plan(files, action);
		el.createEl("p", {
			text: `${scope?.label ?? "No notes"}: ${files.length} ${files.length === 1 ? "note" : "notes"}. ${plan.todo.length} will be processed, ${plan.skipped.length} left as they are.`,
		});
		if (action.kind === "regenerate-citekey") el.createEl("p", { text: "Notes named by their citekey are renamed, and links to them are updated.", cls: "setting-item-description" });
		if (action.kind === "complete") el.createEl("p", { text: "Each note with an ISBN, DOI or URL is looked up online, one at a time. Only empty properties are filled.", cls: "setting-item-description" });
		const warning = this.opts.warning?.(action);
		if (warning) el.createEl("p", { text: warning, cls: "mod-warning" });
		this.list(el, "Will be processed", plan.todo.map((f) => f.path));
		this.list(el, "Left as they are", plan.skipped.map((s) => `${s.item.path}: ${s.skip ?? ""}`));
		new Setting(el)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(`Apply to ${plan.todo.length}`)
					.setCta()
					.setDisabled(!plan.todo.length)
					.onClick(() => void this.run(plan.todo, action))
			);
	}

	private list(el: HTMLElement, heading: string, lines: string[]): void {
		if (!lines.length) return;
		const details = el.createEl("details");
		details.createEl("summary", { text: `${heading} (${lines.length})` });
		const ul = details.createEl("ul");
		for (const line of lines.slice(0, LIST_LIMIT)) ul.createEl("li", { text: line });
		if (lines.length > LIST_LIMIT) details.createEl("p", { text: `…and ${lines.length - LIST_LIMIT} more.` });
	}

	private async run(files: TFile[], action: BatchAction): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.stop = false;
		this.formEl.empty();
		const el = this.previewEl;
		el.empty();
		const progress = el.createEl("p", { text: `0 of ${files.length}…` });
		new Setting(el).addButton((b) =>
			b.setButtonText("Stop").onClick(() => {
				this.stop = true;
				b.setDisabled(true);
			})
		);
		const paths = new Map(files.map((f) => [f, f.path]));
		const result = await runBatch(
			files,
			(f) => this.batch.apply(f, action),
			{ cancelled: () => this.stop, progress: (done, total) => progress.setText(`${done} of ${total}…`) },
			(e) => e instanceof Cancelled
		);
		this.running = false;
		if (this.closed) new Notice(`Stacks: batch edit stopped. ${describeResult(result)}`);
		else this.showResult(result, paths);
	}

	private showResult(r: BatchResult<TFile>, paths: Map<TFile, string>): void {
		const el = this.previewEl;
		el.empty();
		el.createEl("p", { text: describeResult(r) });
		this.list(el, "Failed", r.failed.map((f) => `${paths.get(f.item) ?? f.item.path}: ${f.error}`));
		this.list(el, "Not done", r.notRun.map((f) => f.path));
		new Setting(el).addButton((b) => b.setButtonText("Close").setCta().onClick(() => this.close()));
	}
}
