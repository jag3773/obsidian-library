import { App, Modal, Setting } from "obsidian";
import { PdfRepair } from "../health";

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Preview of PDF relinks, each with a toggle. Nothing changes until Relink is chosen. */
export class RepairModal extends Modal {
	private chosen: Set<PdfRepair>;

	constructor(
		app: App,
		private repairs: PdfRepair[],
		private pdfProperty: string,
		private onApply: (chosen: PdfRepair[]) => void
	) {
		super(app);
		this.chosen = new Set(repairs);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle("Relink PDFs named after citekeys");
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: `Each note's ${this.pdfProperty} property will point at the PDF shown, which is also added to its attachments. Note bodies aren't touched. Untick any you don't want.`,
		});
		for (const r of this.repairs) {
			new Setting(contentEl)
				.setName(nameOf(r.note).replace(/\.md$/, ""))
				.setDesc(`${r.previous ? `${r.previous} (not found)` : "(no PDF)"}  →  ${r.pdf}`)
				.addToggle((t) =>
					t.setValue(true).onChange((on) => {
						if (on) this.chosen.add(r);
						else this.chosen.delete(r);
					})
				);
		}
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Relink")
					.setCta()
					.onClick(() => {
						this.close();
						this.onApply(this.repairs.filter((r) => this.chosen.has(r)));
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
