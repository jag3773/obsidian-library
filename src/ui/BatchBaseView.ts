import { BasesView, BasesViewFactory, QueryController, TFile, requireApiVersion } from "obsidian";

export const BATCH_VIEW_TYPE = "stacks-batch";

/**
 * The factory for a Bases view type ("Stacks batch") that lists the rows its query returns
 * and offers batch edits on exactly those rows. Obsidian evaluates the view's filters itself,
 * so the scope is the real result of the Base, not a re-implementation of its expression
 * language. Plugins can't read the rows of Obsidian's own table or cards views, which is why
 * this is a separate view: add it to a Base next to a table with the same filters.
 *
 * Null before Obsidian 1.10, where Bases has no plugin views; the class is only defined
 * after that check, because BasesView doesn't exist in older versions.
 */
export function batchViewFactory(openBatch: (files: TFile[]) => void): BasesViewFactory | null {
	if (requireApiVersion("1.10.0")) {
		class BatchBaseView extends BasesView {
			type = BATCH_VIEW_TYPE;

			constructor(
				controller: QueryController,
				private root: HTMLElement
			) {
				super(controller);
			}

			private files(): TFile[] {
				return this.data.data.map((e) => e.file);
			}

			onDataUpdated(): void {
				const el = this.root;
				el.empty();
				const files = this.files();
				const header = el.createDiv({ cls: "stacks-batch-view-header" });
				header.createSpan({ text: `${files.length} ${files.length === 1 ? "note" : "notes"} in this view` });
				const button = header.createEl("button", { text: "Batch edit…", cls: "mod-cta" });
				button.disabled = !files.length;
				// Read the rows at click time: the result set is replaced whenever the vault changes.
				button.addEventListener("click", () => openBatch(this.files()));
				const list = el.createEl("ul", { cls: "stacks-batch-view-list" });
				for (const f of files) {
					const link = list.createEl("li").createEl("a", { text: f.basename, cls: "internal-link", href: "#" });
					link.addEventListener("click", (evt) => {
						evt.preventDefault();
						void this.app.workspace.getLeaf(false).openFile(f);
					});
				}
			}
		}

		return (controller, el) => new BatchBaseView(controller, el);
	}
	return null;
}
