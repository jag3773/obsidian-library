import { App, Modal, Setting } from "obsidian";
import type { ConflictChoice, ConflictInfo } from "../roundtrip";

const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (ms: number) => (ms ? new Date(ms).toLocaleString() : "unknown");
const count = (n?: number) => (n === undefined ? "unreadable" : `${n} annotation${n === 1 ? "" : "s"}`);

/** Shown when a PDF changed both in the vault and in the tablet folder. Either way, both copies are kept. */
export class ConflictModal extends Modal {
	private choice: ConflictChoice = "later";

	constructor(
		app: App,
		private info: ConflictInfo,
		private done: (choice: ConflictChoice) => void
	) {
		super(app);
	}

	static ask(app: App, info: ConflictInfo): Promise<ConflictChoice> {
		return new Promise((resolve) => new ConflictModal(app, info, resolve).open());
	}

	onOpen(): void {
		const { contentEl, info } = this;
		this.setTitle(`${info.attachment.name} changed in both places`);
		contentEl.createEl("p", {
			text: `The PDF for ${info.note.basename} was changed in the vault and in the tablet folder since it was sent. Choose which copy stays the note's PDF. The other is saved next to it and linked from the note, so nothing is lost.`,
		});
		const table = contentEl.createEl("table", { cls: "library-conflict" });
		const head = table.createEl("tr");
		for (const h of ["", "Vault copy", "Tablet copy"]) head.createEl("th", { text: h });
		const row = (label: string, a: string, b: string) => {
			const tr = table.createEl("tr");
			tr.createEl("td", { text: label });
			tr.createEl("td", { text: a });
			tr.createEl("td", { text: b });
		};
		row("Modified", when(info.vault.mtimeMs), when(info.tablet.mtimeMs));
		row("Size", size(info.vault.size), size(info.tablet.size));
		row("Annotations", count(info.vault.annotations), count(info.tablet.annotations));
		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Use tablet copy")
					.setCta()
					.onClick(() => this.pick("tablet"))
			)
			.addButton((b) => b.setButtonText("Keep vault copy").onClick(() => this.pick("vault")))
			.addButton((b) => b.setButtonText("Decide later").onClick(() => this.pick("later")));
	}

	private pick(choice: ConflictChoice): void {
		this.choice = choice;
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		this.done(this.choice);
	}
}
