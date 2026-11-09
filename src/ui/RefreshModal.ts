import { App, Modal, Setting } from "obsidian";
import { FieldChange } from "../manual";
import { asText } from "../text";

const show = (v: unknown) => (v === undefined || v === null || v === "" ? "(empty)" : Array.isArray(v) ? v.join("; ") : asText(v));

/**
 * The fields a fresh lookup would change, each with a checkbox. Empty fields are ticked;
 * fields that already have a value aren't, so nothing you wrote is replaced unless you choose it.
 */
export class RefreshModal extends Modal {
	private chosen: Set<FieldChange>;

	constructor(
		app: App,
		private noteName: string,
		private source: string,
		private changes: FieldChange[],
		private onApply: (chosen: FieldChange[]) => void
	) {
		super(app);
		this.chosen = new Set(changes.filter((c) => c.fills));
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle(`Refresh ${this.noteName}`);
		contentEl.createEl("p", {
			text: `${this.source} has different values for these fields. Tick the ones to apply; the note's body isn't touched.`,
			cls: "setting-item-description",
		});
		for (const c of this.changes) {
			new Setting(contentEl)
				.setName(c.label)
				.setDesc(`${show(c.current)}  →  ${show(c.proposed)}`)
				.addToggle((t) =>
					t.setValue(this.chosen.has(c)).onChange((on) => {
						if (on) this.chosen.add(c);
						else this.chosen.delete(c);
					})
				);
		}
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Apply")
					.setCta()
					.onClick(() => {
						this.close();
						this.onApply(this.changes.filter((c) => this.chosen.has(c)));
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
