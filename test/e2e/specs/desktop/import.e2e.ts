// Import bibliography file: a CSL-JSON file in the vault, previewed and imported.
import { browser, expect } from "@wdio/globals";
import { beforeEach, describe, it } from "mocha";
import { frontmatter, read, resetLibrary, runCommand, waitForFiles, waitForNotice } from "../../helpers/stacks";

const CSL_JSON = JSON.stringify(
	[
		{
			id: "knuthArtComputerProgramming1968",
			type: "book",
			title: "The Art of Computer Programming",
			author: [{ family: "Knuth", given: "Donald E." }],
			issued: { "date-parts": [[1968]] },
			publisher: "Addison-Wesley",
		},
		{
			id: "hopperEducationComputer1952",
			type: "article-journal",
			title: "The Education of a Computer",
			author: [{ family: "Hopper", given: "Grace Murray" }],
			issued: { "date-parts": [[1952]] },
			"container-title": "Proceedings of the ACM",
			page: "243-249",
			DOI: "10.1234/e2e.hopper",
		},
		// Already in the library (same citekey): updated, not created again.
		{
			id: "hookerLaws1989",
			type: "book",
			title: "Of the Laws of Ecclesiastical Polity",
			author: [{ family: "Hooker", given: "Richard" }],
			issued: { "date-parts": [[1989]] },
			publisher: "Cambridge University Press",
			ISBN: "9780521379083",
		},
	],
	null,
	2
);

describe("Import bibliography file", function () {
	beforeEach(async function () {
		await resetLibrary({ "Imports/library.json": CSL_JSON });
	});

	it("previews, then creates and updates reference notes from CSL-JSON", async function () {
		await runCommand("import-bibliography");
		const modal = browser.$(".modal-container .modal");
		await expect(modal.$(".modal-title")).toHaveText("Import bibliography file");
		const input = modal.$(".setting-item-name=Bibliography file").parentElement().parentElement().$("input");
		await input.setValue("Imports/library.json");
		// Close the path suggestions so they don't cover the buttons.
		await browser.keys("Escape");
		await expect(modal).toBeDisplayed();
		await expect(modal.$("button=Import")).toBeDisabled();
		await modal.$("button=Preview").click();

		await modal.$("h4=Preview").waitForExist();
		const preview = await modal.getText();
		expect(preview).toContain("3 records in the file (CSL-JSON)");
		expect(preview).toContain("2 notes to create");
		expect(preview).toContain("1 notes to update");
		// Nothing written by the preview.
		expect(await waitForFiles("References", () => true, "")).not.toContain("References/knuthArtComputerProgramming1968.md");

		await modal.$("button=Import").click();
		await waitForNotice("Stacks: import done.");
		await waitForFiles(
			"References",
			(p) => p.includes("References/knuthArtComputerProgramming1968.md") && p.includes("References/hopperEducationComputer1952.md"),
			"imported notes weren't created"
		);
		expect(await frontmatter("References/knuthArtComputerProgramming1968.md")).toMatchObject({
			citekey: "knuthArtComputerProgramming1968",
			type: "book",
			title: "The Art of Computer Programming",
			year: 1968,
			publisher: "Addison-Wesley",
		});
		expect(await frontmatter("References/hopperEducationComputer1952.md")).toMatchObject({
			citekey: "hopperEducationComputer1952",
			doi: "10.1234/e2e.hopper",
			journal: "Proceedings of the ACM",
		});
		// The existing note gained the ISBN and kept its body and status.
		expect(await frontmatter("References/hookerLaws1989.md")).toMatchObject({ isbn: "9780521379083", status: "queued" });
		expect(await read("References/hookerLaws1989.md")).toContain("# Of the Laws of Ecclesiastical Polity");
	});
});
