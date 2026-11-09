import { App, Modal } from "obsidian";

export interface ReportSection {
	heading: string;
	lines: string[];
}

/** A read-only report: a summary, then sections of lines, each capped with a count of the rest. */
export class ReportModal extends Modal {
	constructor(
		app: App,
		private heading: string,
		private summary: string[],
		private sections: ReportSection[],
		private limit = 200
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.heading);
		const { contentEl } = this;
		contentEl.empty();
		for (const line of this.summary) contentEl.createEl("p", { text: line });
		for (const section of this.sections) {
			if (!section.lines.length) continue;
			contentEl.createEl("h4", { text: `${section.heading} (${section.lines.length})` });
			const list = contentEl.createEl("ul");
			for (const line of section.lines.slice(0, this.limit)) list.createEl("li", { text: line });
			if (section.lines.length > this.limit) contentEl.createEl("p", { text: `…and ${section.lines.length - this.limit} more.` });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
