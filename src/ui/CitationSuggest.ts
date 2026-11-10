import { App, Modal, Setting, SuggestModal } from "obsidian";
import { CiteRef, searchRefs } from "../cite";

/** Pick a reference note by citekey, title, author or year. */
export class CitationSuggest extends SuggestModal<CiteRef> {
	constructor(
		app: App,
		private refs: CiteRef[],
		private onPick: (ref: CiteRef) => void
	) {
		super(app);
		this.setPlaceholder("Search by citekey, title, author or year");
		this.emptyStateText = "No matching references.";
		this.setInstructions([
			{ command: "↑↓", purpose: "to navigate" },
			{ command: "↵", purpose: "to cite" },
			{ command: "esc", purpose: "to dismiss" },
		]);
	}

	getSuggestions(query: string): CiteRef[] {
		return searchRefs(this.refs, query, 50);
	}

	renderSuggestion(ref: CiteRef, el: HTMLElement): void {
		el.createDiv({ text: ref.title || ref.key });
		el.createEl("small", { text: [ref.authors, ref.year, ref.key].filter(Boolean).join(" · "), cls: "stacks-cite-meta" });
	}

	onChooseSuggestion(ref: CiteRef): void {
		this.onPick(ref);
	}
}

/** Ask for an optional page or other locator. Enter inserts (an empty field inserts none); Escape cancels. */
export class LocatorModal extends Modal {
	private value = "";

	constructor(
		app: App,
		private citekey: string,
		private onSubmit: (locator: string) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle(`Cite ${this.citekey}`);
		const submit = () => {
			this.close();
			this.onSubmit(this.value.trim());
		};
		new Setting(contentEl)
			.setName("Page or locator")
			.setDesc("Optional. A number is a page: 12 or 12-14. Or write the label: chap. 3, sec. 2.")
			.addText((t) => {
				t.setPlaceholder("12").onChange((v) => (this.value = v));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						submit();
					}
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});
		new Setting(contentEl).addButton((b) => b.setButtonText("Insert").setCta().onClick(submit));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
