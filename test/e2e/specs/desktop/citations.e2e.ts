// Copy formatted citation and Copy formatted bibliography: what they put on the clipboard.
import { browser, expect } from "@wdio/globals";
import { beforeEach, describe, it } from "mocha";
import { openFile, resetLibrary, runCommand, takeClipboardWrites, waitForNotice } from "../../helpers/stacks";

/** The one clipboard write the command made. */
async function copied(): Promise<{ text: string; html?: string }> {
	let writes: { text: string; html?: string }[] = [];
	await browser.waitUntil(async () => (writes = [...writes, ...(await takeClipboardWrites())]).length > 0, { timeoutMsg: "nothing was copied" });
	expect(writes).toHaveLength(1);
	return writes[0];
}

describe("Copy formatted citation", function () {
	beforeEach(async function () {
		await resetLibrary();
		await takeClipboardWrites();
	});

	it("copies a Chicago author-date citation as text and HTML", async function () {
		await openFile("References/porterCreatingSharedValue2011.md");
		await runCommand("copy-formatted-citation");
		await waitForNotice(/^Stacks: copied citation \(Chicago Manual of Style 18th edition \(author-date\)\)\.$/);
		const c = await copied();
		expect(c.text).toBe("(Porter and Kramer 2011)");
		expect(c.html).toContain("(Porter and Kramer 2011)");
	});

	it("copies a Chicago bibliography for the references a draft cites", async function () {
		await resetLibrary({
			"Drafts/Essay.md": "# Essay\n\nAs argued [@hookerLaws1989] and in [[porterCreatingSharedValue2011]], and [@missingKey2020].\n",
		});
		await openFile("Drafts/Essay.md");
		await runCommand("copy-formatted-bibliography");
		const notice = await waitForNotice("Stacks: copied bibliography of 2 references");
		expect(notice).toContain("Not in your library: missingKey2020");
		const c = await copied();
		// In first-cited order, sorted by the style: Hooker before Porter.
		expect(c.text).toBe(
			"Hooker, Richard. 1989. Of the Laws of Ecclesiastical Polity. Cambridge University Press.\n" +
				"Porter, Michael E., and Mark R. Kramer. 2011. “Creating Shared Value.” Harvard Business Review 89 (1): 62–77. https://doi.org/10.1234/e2e.porter."
		);
		// Italics survive in the HTML.
		expect(c.html).toMatch(/<i>Of the Laws of Ecclesiastical Polity<\/i>/);
		expect(c.html).toMatch(/<i>Harvard Business Review<\/i>/);
	});
});
