// Create library base, then open it in Obsidian's Bases and read what each view selects.
// Desktop, Obsidian 1.10 and later (see wdio.conf.mts).
//
// What this proves: Obsidian parses the generated .base, evaluates every view's filters,
// including note[...].isEmpty() on notes that lack the property, have an empty list or an
// empty string, without an error, and the views select exactly the expected notes. Rows are
// read from the Bases query controller's results (the internal API behind the table) and
// cross-checked against the rendered table and its result count.
import { browser, expect } from "@wdio/globals";
import { beforeEach, describe, it } from "mocha";
import { frontmatter, read, resetLibrary, runCommand, waitForFiles, waitForNotice } from "../../helpers/stacks";

interface ViewResult {
	error: string | null;
	errorText: string;
	files: string[];
	count: string;
	rendered: string[];
}

/** Open a view of a base in the active tab and read what it shows once its query has run. */
async function openView(file: string, viewName: string): Promise<ViewResult> {
	return browser.executeObsidian(
		async ({ app }, path, name) => {
			const leaf = app.workspace.getLeaf(false);
			await leaf.setViewState({ type: "bases", state: { file: path, viewName: name } });
			const view = leaf.view as any;
			if (view.getViewType() !== "bases") throw new Error(`opened a ${view.getViewType()} view`);
			const c = view.controller;
			// Wait for the query to run and the table to render.
			for (let i = 0; i < 100 && (c.viewName !== name || !view.containerEl.querySelector(".bases-toolbar-result-count")?.textContent); i++)
				await new Promise((r) => setTimeout(r, 100));
			await new Promise((r) => setTimeout(r, 500));
			const el = view.containerEl as HTMLElement;
			return {
				error: c.error ? String(c.error) : null,
				errorText: Array.from(el.querySelectorAll(".bases-error")).map((e) => e.textContent ?? "").join(""),
				files: Array.from((c.results as Map<{ path: string }, unknown>).keys()).map((f) => f.path).sort(),
				count: el.querySelector(".bases-toolbar-result-count")?.textContent ?? "",
				// The text of each rendered table row.
				rendered: Array.from(el.querySelectorAll(".bases-tbody .bases-tr")).map((r) => r.textContent ?? ""),
			};
		},
		file,
		viewName
	);
}

const EDGE_CASES = {
	// An empty collections list and an empty pdf string count as empty too.
	"References/dijkstraGoToStatement1968.md":
		'---\ncitekey: dijkstraGoToStatement1968\ntype: article\ntitle: Go To Statement Considered Harmful\nauthors:\n  - "[[Edsger W. Dijkstra]]"\nyear: 1968\njournal: Communications of the ACM\ncollections: []\npdf: ""\nstatus: queued\n---\n',
	// Not a reference (no citekey): never in the library base.
	"References/Reading notes.md": "---\ntitle: Notes about my reading\n---\nJust notes.\n",
};

describe("Library base in Bases", function () {
	beforeEach(async function () {
		await resetLibrary(EDGE_CASES);
	});

	it("is created next to an existing base without overwriting anything, and becomes the library base", async function () {
		const existing = await read("Reading list.base");
		await runCommand("create-library-base");
		await waitForNotice("Stacks: created Library.base.");
		await waitForFiles("", (p) => p.includes("Library.base"), "no Library.base");
		expect(await read("Reading list.base")).toBe(existing);
		expect(await browser.executeObsidian(({ app }) => (app as any).plugins.plugins.stacks.settings.libraryBase)).toBe("Library.base");

		// A second run picks a free name.
		await runCommand("create-library-base");
		await waitForNotice("Stacks: created Library 1.base.");
		expect(await browser.executeObsidian(({ app }) => (app as any).plugins.plugins.stacks.settings.libraryBase)).toBe("Library.base");
	});

	it("evaluates every view, including Unfiled and Missing PDF, without errors", async function () {
		await runCommand("create-library-base");
		await waitForFiles("", (p) => p.includes("Library.base"), "no Library.base");

		const all = ["References/dijkstraGoToStatement1968.md", "References/hookerLaws1989.md", "References/liskovProgrammingAbstractData1974.md", "References/porterCreatingSharedValue2011.md"];
		const expected: Record<string, string[]> = {
			Library: all,
			Queued: ["References/dijkstraGoToStatement1968.md", "References/hookerLaws1989.md"],
			Reading: ["References/porterCreatingSharedValue2011.md"],
			Reviewing: [],
			Processed: ["References/liskovProgrammingAbstractData1974.md"],
			Shelved: [],
			// No collections property (Hooker), or an empty list (Dijkstra).
			Unfiled: ["References/dijkstraGoToStatement1968.md", "References/hookerLaws1989.md"],
			// No pdf property (Hooker, Liskov), or an empty string (Dijkstra). Porter has one.
			"Missing PDF": ["References/dijkstraGoToStatement1968.md", "References/hookerLaws1989.md", "References/liskovProgrammingAbstractData1974.md"],
		};
		const names = await browser.executeObsidian(({ app }) => {
			const view = app.workspace.getMostRecentLeaf()!.view as any;
			return view.controller.getQueryViewNames() as string[];
		});
		expect(names).toEqual(Object.keys(expected));

		const titles = Object.fromEntries(
			await Promise.all(all.map(async (p) => [p, String((await frontmatter(p))?.title)] as const))
		);
		for (const [view, files] of Object.entries(expected)) {
			const r = await openView("Library.base", view);
			expect({ view, error: r.error, errorText: r.errorText }).toEqual({ view, error: null, errorText: "" });
			expect({ view, files: r.files }).toEqual({ view, files });
			expect({ view, count: r.count }).toEqual({ view, count: `${files.length} ${files.length === 1 ? "result" : "results"}` });
			// The table shows the same rows, each with the title the base's name formula gives it.
			expect({ view, rows: r.rendered.length }).toEqual({ view, rows: files.length });
			for (const f of files) expect({ view, title: titles[f], shown: r.rendered.some((row) => row.includes(titles[f])) }).toEqual({ view, title: titles[f], shown: true });
		}
	});

	it("lists a Stacks batch view's rows and opens the batch preview for exactly those", async function () {
		await resetLibrary({
			...EDGE_CASES,
			"Queue.base":
				'filters:\n  and:\n    - file.inFolder("References")\n    - file.hasProperty("citekey")\nviews:\n  - type: stacks-batch\n    name: Queued\n    filters: note["status"] == "queued"\n',
		});
		const r = await openView("Queue.base", "Queued");
		expect(r.error).toBeNull();
		expect(r.files).toEqual(["References/dijkstraGoToStatement1968.md", "References/hookerLaws1989.md"]);
		const view = browser.$(".workspace-leaf.mod-active .stacks-batch-view-header");
		await expect(view).toHaveText(expect.stringContaining("2 notes in this view"));
		await view.$("button=Batch edit…").click();
		const modal = browser.$(".modal-container .modal");
		await browser.waitUntil(async () => (await modal.getText()).includes("2 in this Base view: 2 notes."), { timeoutMsg: "batch preview didn't open for the view's rows" });
	});
});
