import { App, Modal, Setting } from "obsidian";

/** Asks for an ISBN, DOI, arXiv ID or URL. */
export class AddReferenceModal extends Modal {
	private value = "";

	constructor(app: App, private onSubmit: (value: string) => void) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle("Add reference");
		contentEl.createEl("p", {
			text: "Paste an ISBN, DOI, arXiv ID or URL.",
			cls: "setting-item-description",
		});
		const submit = () => {
			if (!this.value.trim()) return;
			this.close();
			this.onSubmit(this.value.trim());
		};
		new Setting(contentEl).setName("Identifier").addText((t) => {
			t.setPlaceholder("978-0-14-312837-3  ·  10.1000/xyz  ·  https://…").onChange((v) => (this.value = v));
			t.inputEl.addClass("reference-library-input");
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					submit();
				}
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(contentEl).addButton((b) => b.setButtonText("Look up").setCta().onClick(submit));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
