// Runs on desktop, emulated mobile and Android: the Insert citation picker.
import { browser, expect } from "@wdio/globals";
import { beforeEach, describe, it } from "mocha";
import { openFile, read, resetLibrary, runCommand } from "../../helpers/stacks";

describe("Insert citation", function () {
	beforeEach(async function () {
		await resetLibrary();
		await openFile("Drafts/Essay.md");
	});

	async function selectPlaceholder(): Promise<void> {
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			if (!view) throw new Error("no editor");
			const editor = view.editor;
			const line = editor.getValue().split("\n").findIndex((l) => l.includes("CITE_HERE"));
			const ch = editor.getLine(line).indexOf("CITE_HERE");
			editor.focus();
			editor.setSelection({ line, ch }, { line, ch: ch + "CITE_HERE".length });
		});
	}

	async function pick(query: string, title: string): Promise<void> {
		const input = browser.$(".prompt .prompt-input");
		await input.waitForDisplayed();
		await input.setValue(query);
		const item = browser.$(".prompt .suggestion-item.is-selected");
		await browser.waitUntil(async () => (await item.getText()).includes(title), { timeoutMsg: `${title} isn't the first suggestion` });
		await browser.keys("Enter");
		await browser.$(".prompt").waitForExist({ reverse: true });
	}

	async function editorText(): Promise<string> {
		return browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.getValue());
	}

	it("inserts [@citekey] at the cursor", async function () {
		await selectPlaceholder();
		await runCommand("insert-citation");
		await pick("porter shared", "Creating Shared Value");
		expect(await editorText()).toContain("Shared value changes how firms compete [@porterCreatingSharedValue2011].");
		// And it is saved to the note.
		await browser.waitUntil(async () => (await read("Drafts/Essay.md")).includes("[@porterCreatingSharedValue2011]"), { timeoutMsg: "not saved" });
	});

	it("adds a second reference to the citation the cursor is in", async function () {
		await selectPlaceholder();
		await runCommand("insert-citation");
		await pick("porter", "Creating Shared Value");
		// The cursor is now just after the inserted citation; move it inside the brackets.
		await browser.executeObsidian(({ app, obsidian }) => {
			const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor;
			const cur = editor.getCursor();
			editor.setCursor({ line: cur.line, ch: cur.ch - 2 });
		});
		await runCommand("insert-citation");
		// Accents and case don't matter in the search.
		await pick("HOOKER 1989", "Of the Laws of Ecclesiastical Polity");
		expect(await editorText()).toContain("[@porterCreatingSharedValue2011; @hookerLaws1989]");
	});
});
