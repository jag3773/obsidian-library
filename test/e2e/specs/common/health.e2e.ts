// Runs on desktop, emulated mobile and Android: Check library health writes its report note.
import { browser, expect } from "@wdio/globals";
import { beforeEach, describe, it } from "mocha";
import { pdfWithText } from "../../helpers/pdf";
import { clearNotices, frontmatter, read, resetLibrary, runCommand, waitForFiles, waitForNotice } from "../../helpers/stacks";

const REPORT = "Stacks health check.md";
const pdf = (text: string) => pdfWithText(text).buffer as ArrayBuffer;

/** Problems added to the fixture library, one per check this test looks at. */
const PROBLEMS = {
	// No citekey.
	"References/Untitled draft reference.md": "---\ntype: book\ntitle: A reference without a citekey\nauthors: [Jane Doe]\nyear: 2001\npublisher: Nowhere Press\n---\n",
	// A pdf link that doesn't resolve, with a PDF named after the citekey that the relink command can use.
	"References/turingComputingMachinery1950.md":
		'---\ncitekey: turingComputingMachinery1950\ntype: article\ntitle: Computing Machinery and Intelligence\nauthors: ["[[Alan Turing]]"]\nyear: 1950\njournal: Mind\nvolume: "59"\nissue: "236"\npages: 433-460\npdf: "[[turing-old-name.pdf]]"\n---\n',
	"References/attachments/turingComputingMachinery1950.pdf": pdf("Computing Machinery and Intelligence"),
	// A PDF no note links to.
	"References/attachments/stray scan.pdf": pdf("A stray scan"),
};

describe("Check library health", function () {
	beforeEach(async function () {
		await resetLibrary(PROBLEMS);
	});

	it("writes the report note with its marker and the problems found", async function () {
		await runCommand("check-library-health");
		await waitForFiles("", (p) => p.includes(REPORT), "no report note");
		const notice = await waitForNotice(/Stacks: \d+ problems? in 5 notes/);
		expect(notice).toContain("1 PDF link can be repaired");

		expect(await frontmatter(REPORT)).toEqual({ stacks: "health-check" });
		const text = await read(REPORT);
		expect(text).toContain("# Library health check");
		expect(text).toContain("Checked 5 reference notes");
		expect(text).toMatch(/## No citekey \(1\)\n[\s\S]*Untitled draft reference/);
		expect(text).toMatch(/## pdf links that don't resolve \(1\)\n[\s\S]*turingComputingMachinery1950[\s\S]*turing-old-name\.pdf[\s\S]*Found [^\n]*turingComputingMachinery1950\.pdf/);
		// Both PDFs are unlinked: the stray one, and the one the broken link should point at.
		expect(text).toMatch(/## PDFs in the attachments folder with no note \(2\)\n[\s\S]*stray scan\.pdf[\s\S]*turingComputingMachinery1950\.pdf/);
		// The report opens.
		expect(await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path)).toBe(REPORT);
	});

	it("rewrites its own report, and never overwrites a note of yours with the same name", async function () {
		await runCommand("check-library-health");
		await waitForFiles("", (p) => p.includes(REPORT), "no report note");
		await clearNotices();
		await runCommand("check-library-health");
		await waitForNotice(/in 5 notes/);
		await browser.pause(1000);
		expect((await waitForFiles("", () => true, "")).filter((p) => p.startsWith("Stacks health check"))).toEqual([REPORT]);

		// A note of the user's that has the report's name stays as it is.
		await resetLibrary({ ...PROBLEMS, [REPORT]: "My own notes about library health.\n" });
		await runCommand("check-library-health");
		await waitForFiles("", (p) => p.includes("Stacks health check 1.md"), "the report wasn't written beside the user's note");
		expect(await read(REPORT)).toBe("My own notes about library health.\n");
		expect(await frontmatter("Stacks health check 1.md")).toEqual({ stacks: "health-check" });
	});
});
