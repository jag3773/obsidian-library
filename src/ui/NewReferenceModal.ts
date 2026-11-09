import { App, Modal, Setting } from "obsidian";
import { MANUAL_TYPES, ManualInput, manualReference } from "../manual";
import { ReferenceData } from "../metadata/types";

/**
 * A short form for a reference with no lookup: type, title, authors, date and an optional
 * identifier. Everything else is filled in afterwards in the note's own properties.
 */
export class NewReferenceModal extends Modal {
	private input: ManualInput = { type: "book", title: "", authors: "", date: "", identifier: "" };
	private errorEl: HTMLElement | null = null;

	constructor(app: App, private onSubmit: (data: ReferenceData) => void) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle("New reference");
		contentEl.createEl("p", {
			text: "For items no lookup can find: talks, interviews, older books, internal documents. Fill in the rest in the note's properties.",
			cls: "setting-item-description",
		});
		new Setting(contentEl).setName("Type").addDropdown((d) => {
			for (const [k, label] of Object.entries(MANUAL_TYPES)) d.addOption(k, label);
			d.setValue(this.input.type).onChange((v) => (this.input.type = v));
		});
		new Setting(contentEl).setName("Title").addText((t) => {
			t.onChange((v) => (this.input.title = v));
			t.inputEl.addClass("stacks-input");
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					this.submit();
				}
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(contentEl)
			.setName("Authors")
			.setDesc('One per line. "Jane Doe", "Doe, Jane", or an organization in braces: {Example Church}.')
			.addTextArea((t) => {
				t.onChange((v) => (this.input.authors = v));
				t.inputEl.rows = 3;
				t.inputEl.addClass("stacks-input");
			});
		new Setting(contentEl)
			.setName("Date")
			.setDesc("A year or a full date. Optional.")
			.addText((t) => t.setPlaceholder("2024 or 2024-03-17").onChange((v) => (this.input.date = v)));
		new Setting(contentEl)
			.setName("Identifier")
			.setDesc("Optional ISBN, DOI or URL, stored without a lookup.")
			.addText((t) => t.onChange((v) => (this.input.identifier = v)));
		this.errorEl = contentEl.createEl("p", { cls: "stacks-error" });
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText("Create").setCta().onClick(() => this.submit()));
	}

	private submit(): void {
		const { data, error } = manualReference(this.input);
		if (!data) {
			this.errorEl?.setText(error ?? "");
			return;
		}
		this.close();
		this.onSubmit(data);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
