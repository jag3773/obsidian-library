import { App, Modal, Setting } from "obsidian";
import { PdfCandidate, PdfSearch, describeCandidate } from "../metadata/fulltext";

/** Shows where a PDF was found, before anything is downloaded. Resolves with the choice, or null. */
export class FindPdfModal extends Modal {
	private choice: PdfCandidate | null = null;

	constructor(
		app: App,
		private noteName: string,
		private search: PdfSearch,
		private done: (choice: PdfCandidate | null) => void
	) {
		super(app);
	}

	static ask(app: App, noteName: string, search: PdfSearch): Promise<PdfCandidate | null> {
		return new Promise((resolve) => new FindPdfModal(app, noteName, search, resolve).open());
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle(`PDF for ${this.noteName}`);
		contentEl.createEl("p", {
			text: "Choose a copy to download. Stacks checks that it is a PDF before saving it to your attachments folder and linking it from the note. Check that the version suits your use.",
		});
		this.search.candidates.forEach((c, i) => {
			new Setting(contentEl)
				.setName(describeCandidate(c))
				.setDesc(c.url)
				.addButton((b) => {
					b.setButtonText("Download").onClick(() => this.pick(c));
					if (i === 0) b.setCta();
				});
		});
		if (this.search.notes.length) {
			const list = contentEl.createEl("ul");
			for (const n of this.search.notes) list.createEl("li", { text: n });
		}
		new Setting(contentEl).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	private pick(c: PdfCandidate): void {
		this.choice = c;
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		this.done(this.choice);
	}
}
