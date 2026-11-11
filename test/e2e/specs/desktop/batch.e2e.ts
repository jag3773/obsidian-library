// Batch edit references: started from a folder's menu in the file explorer, preview, then apply.
import { browser, expect } from "@wdio/globals";
import { beforeEach, describe, it } from "mocha";
import { frontmatter, read, resetLibrary } from "../../helpers/stacks";

const KUHN = "References/Books/kuhnStructureScientificRevolutions1962.md";

/** Right-click a folder in the file explorer and choose a menu item. */
async function folderMenu(path: string, item: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, folder) => {
		let leaf = app.workspace.getLeavesOfType("file-explorer")[0];
		if (!leaf) {
			leaf = app.workspace.getLeftLeaf(false)!;
			await leaf.setViewState({ type: "file-explorer" });
		}
		await app.workspace.revealLeaf(leaf);
		// Expand the folders above it.
		(leaf.view as any).revealInFolder(app.vault.getFolderByPath(folder));
	}, path);
	const title = browser.$(`.nav-folder-title[data-path="${path}"]`);
	await title.waitForDisplayed();
	await title.click({ button: "right" });
	const menuItem = browser.$(".menu").$(`.menu-item-title=${item}`);
	await menuItem.waitForDisplayed();
	await menuItem.click();
}

/** The select in the batch dialog's setting with this name. */
const dropdown = (name: string) => browser.$(".modal-container").$(`.setting-item-name=${name}`).parentElement().parentElement().$("select");

describe("Batch edit references", function () {
	beforeEach(async function () {
		await resetLibrary({
			[KUHN]: "---\ncitekey: kuhnStructureScientificRevolutions1962\ntype: book\ntitle: The Structure of Scientific Revolutions\nauthors:\n  - \"[[Thomas S. Kuhn]]\"\nyear: 1962\npublisher: University of Chicago Press\nstatus: queued\n---\n# The Structure of Scientific Revolutions\n\nMy notes stay as they are.\n",
		});
	});

	it("sets the status of every reference in a folder after a preview", async function () {
		const kuhnBefore = await read(KUHN);
		await folderMenu("References", "Batch edit references in this folder");
		const modal = browser.$(".modal-container .modal");
		await expect(modal.$(".modal-title")).toHaveText("Batch edit references");
		await dropdown("Status").selectByAttribute("value", "processed");

		// The preview names the scope, counts the notes, and lists who is left alone and why.
		await browser.waitUntil(async () => (await modal.getText()).includes("References in References: 4 notes. 3 will be processed, 1 left as they are."), {
			timeoutMsg: "preview didn't update",
		});
		const leftAlone = modal.$("summary=Left as they are (1)");
		await leftAlone.click();
		await expect(modal).toHaveText(expect.stringContaining("References/liskovProgrammingAbstractData1974.md: already processed"));
		// Nothing is written before Apply.
		expect((await frontmatter("References/hookerLaws1989.md"))?.status).toBe("queued");

		await modal.$("button=Apply to 3").click();
		await browser.waitUntil(async () => (await modal.getText()).includes("3 changed."), { timeoutMsg: "batch didn't finish" });
		await modal.$("button=Close").click();

		for (const path of ["References/porterCreatingSharedValue2011.md", "References/hookerLaws1989.md", "References/liskovProgrammingAbstractData1974.md", KUHN])
			expect((await frontmatter(path))?.status).toBe("processed");
		// Only the property changed: the body is untouched.
		expect(await read(KUHN)).toBe(kuhnBefore.replace("status: queued", "status: processed"));
	});

	it("limits a subfolder's batch to that subfolder, and Cancel writes nothing", async function () {
		await folderMenu("References/Books", "Batch edit references in this folder");
		const modal = browser.$(".modal-container .modal");
		await dropdown("Status").selectByAttribute("value", "reading");
		await browser.waitUntil(async () => (await modal.getText()).includes("References in References/Books: 1 note. 1 will be processed, 0 left as they are."), {
			timeoutMsg: "preview didn't update",
		});
		await modal.$("button=Cancel").click();
		await browser.$(".modal-container").waitForExist({ reverse: true });
		expect((await frontmatter(KUHN))?.status).toBe("queued");
	});
});
