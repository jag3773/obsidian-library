// Review duplicate references: the list, the merge preview, and the merge itself.
import { browser, expect } from "@wdio/globals";
import { beforeEach, describe, it } from "mocha";
import { files, frontmatter, read, resetLibrary, runCommand, waitForNotice } from "../../helpers/stacks";

const DUPLICATE = "References/Porter shared value.md";

describe("Review duplicate references", function () {
	beforeEach(async function () {
		await resetLibrary({
			// The same DOI as porterCreatingSharedValue2011, captured again under another name.
			[DUPLICATE]:
				'---\ncitekey: porterCreatingSharedValue2011a\ntype: article\ntitle: Creating shared value\nauthors: ["[[Michael E. Porter]]"]\nyear: 2011\ndoi: https://doi.org/10.1234/E2E.PORTER\npublisher: Harvard Business Publishing\ncollections:\n  - "[[Business]]"\nstatus: queued\n---\n# Creating shared value\n\nMy own note on the second copy.\n',
			"Drafts/Links.md": "# Links\n\nSee [[Porter shared value]] and [[Porter shared value|the duplicate]].\n",
		});
	});

	it("previews the merge, then merges: properties combined, links repointed, the other note trashed", async function () {
		await runCommand("review-duplicates");
		const list = browser.$(".modal-container .modal");
		await expect(list.$(".modal-title")).toHaveText("Duplicate references");
		await expect(list).toHaveText(expect.stringContaining("Porter shared value, porterCreatingSharedValue2011"));
		await expect(list).toHaveText(expect.stringContaining("same DOI"));
		await list.$("button=Review").click();

		const merge = browser.$(".modal-container .modal");
		await browser.waitUntil(async () => (await merge.$(".modal-title").getText()) === "Merge duplicate references", { timeoutMsg: "no merge preview" });
		await merge.$("button=Merge").waitForExist();
		const preview = await merge.getText();
		// The note named after its own citekey is kept.
		expect(preview).toContain("Porter shared value into porterCreatingSharedValue2011");
		expect(preview).toContain("2 links in 1 note will point to porterCreatingSharedValue2011.");
		expect(preview).toContain("publisher: fills in Harvard Business Publishing");
		expect(preview).toContain("collections: adds [[Business]]");
		expect(preview).toContain('1 paragraph only it has go under "Merged from Porter shared value".');
		expect(preview).toContain("Citations written as [@porterCreatingSharedValue2011a] in your drafts aren't changed.");
		expect(preview).toContain("Porter shared value moves to the trash.");
		// Nothing changed yet.
		expect(await files("References")).toContain(DUPLICATE);

		await merge.$("button=Merge").click();
		await waitForNotice("Stacks: merged 1 note into porterCreatingSharedValue2011; 2 links in 1 note now point to it.");

		expect(await files("References")).not.toContain(DUPLICATE);
		// Trashed per the vault's Deleted files setting (the fixture uses the vault's .trash folder).
		expect(await browser.executeObsidian(({ app }) => app.vault.adapter.exists(".trash/Porter shared value.md"))).toBe(true);

		const links = await read("Drafts/Links.md");
		expect(links).toContain("See [[porterCreatingSharedValue2011]] and [[porterCreatingSharedValue2011|the duplicate]].");

		const kept = await frontmatter("References/porterCreatingSharedValue2011.md");
		expect(kept).toMatchObject({
			citekey: "porterCreatingSharedValue2011",
			publisher: "Harvard Business Publishing",
			collections: ["[[Strategy]]", "[[Business]]"],
			status: "reading",
		});
		const body = await read("References/porterCreatingSharedValue2011.md");
		expect(body).toContain("## Merged from Porter shared value");
		expect(body).toContain("My own note on the second copy.");
	});

	it("leaves everything as it was when the preview is cancelled", async function () {
		await runCommand("review-duplicates");
		await browser.$(".modal-container").$("button=Review").click();
		const merge = browser.$(".modal-container .modal");
		await merge.$("button=Merge").waitForExist();
		await merge.$("button=Cancel").click();
		await browser.$(".modal-container").waitForExist({ reverse: true });
		expect(await files("References")).toContain(DUPLICATE);
		expect(await read("Drafts/Links.md")).toContain("[[Porter shared value]]");
	});
});
