// Runs on desktop, emulated mobile and Android: a Web Clipper note saved to the inbox is
// looked up (through the network stub) and filed as a reference note.
import { browser, expect } from "@wdio/globals";
import { beforeEach, describe, it } from "mocha";
import { obsidianPage } from "wdio-obsidian-service";
import { clipNote, frontmatter, read, resetLibrary, stubLog, waitForFiles } from "../../helpers/stacks";

describe("Capture from the inbox", function () {
	beforeEach(async function () {
		await resetLibrary();
	});

	it("files a clip that lands in the inbox", async function () {
		await obsidianPage.write("Inbox/Alpha study.md", clipNote("Alpha study of inboxes", "https://example.org/articles/alpha"));
		const refs = await waitForFiles("References", (p) => p.includes("References/lovelaceAlphaStudyInboxes2021.md"), "the clip wasn't filed");
		await waitForFiles("Inbox", (p) => !p.some((x) => x.endsWith(".md")), "the clip stayed in the inbox");
		// Filed once: one new note next to the fixture's three.
		expect(refs.filter((p) => p.endsWith(".md"))).toHaveLength(4);

		const fm = await frontmatter("References/lovelaceAlphaStudyInboxes2021.md");
		expect(fm).toMatchObject({
			citekey: "lovelaceAlphaStudyInboxes2021",
			title: "Alpha study of inboxes",
			doi: "10.1234/e2e.alpha",
			year: 2021,
			journal: "Journal of End-to-End Tests",
			status: "shelved",
			// The clip keeps the URL it was captured from.
			source: "https://example.org/articles/alpha",
		});
		// The clip's own text is kept.
		expect(await read("References/lovelaceAlphaStudyInboxes2021.md")).toContain("Clipped text of Alpha study of inboxes.");

		const log = await stubLog();
		expect(log.requests).toContain("https://example.org/articles/alpha");
		expect(log.requests.some((u) => u.startsWith("https://api.crossref.org/works/10.1234%2Fe2e.alpha"))).toBe(true);
		await browser.pause(0);
	});
});
