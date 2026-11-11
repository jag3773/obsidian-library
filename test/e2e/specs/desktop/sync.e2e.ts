// Sync-safe and offline capture (#30), in real Obsidian. A sync client (or Finder, or a git
// pull) is simulated by writing into the vault folder from the test process while Obsidian
// runs, so Obsidian learns of each file only through its file watcher.
import { browser, expect } from "@wdio/globals";
import { beforeEach, describe, it } from "mocha";
import { pdfWithText } from "../../helpers/pdf";
import {
	clearNotices,
	clipNote,
	diskRead,
	files,
	frontmatter,
	notesWithDoi,
	resetLibrary,
	runCommand,
	setOffline,
	setSettings,
	stubLog,
	syncAppend,
	syncWrite,
	waitForFiles,
	waitForIndex,
	waitForNotice,
} from "../../helpers/stacks";

/** Longer than Stacks waits for a new inbox file to settle (750 ms) plus a lookup. */
const SETTLE = 3000;

const mdIn = (paths: string[]) => paths.filter((p) => p.endsWith(".md"));

describe("Sync and offline capture", function () {
	beforeEach(async function () {
		await resetLibrary();
	});

	it("files a clip a sync client brings into the inbox, once", async function () {
		await syncWrite("Inbox/Alpha study.md", clipNote("Alpha study of inboxes", "https://example.org/articles/alpha"));
		await waitForFiles("References", (p) => p.includes("References/lovelaceAlphaStudyInboxes2021.md"), "the clip wasn't filed");
		await browser.pause(SETTLE);
		expect(await notesWithDoi("10.1234/e2e.alpha")).toEqual(["References/lovelaceAlphaStudyInboxes2021.md"]);
		expect(mdIn(await files("Inbox"))).toEqual([]);
		expect(mdIn(await files("References"))).toHaveLength(4);
	});

	it("doesn't file the same item twice when two clips of it arrive together", async function () {
		// The same article clipped on two devices, from two URLs that resolve to one DOI.
		await syncWrite("Inbox/Beta report.md", clipNote("Beta report on sync", "https://example.org/articles/beta"));
		await syncWrite("Inbox/Beta report (phone).md", clipNote("Beta report on sync", "https://example.org/articles/beta?utm_source=phone"));
		await browser.executeObsidian(({ app }) => {
			// The second URL is another address for the same page.
			const stub = (app as any).plugins.plugins["stacks-e2e-stub"];
			stub.routes["https://example.org/articles/beta?utm_source=phone"] = stub.routes["https://example.org/articles/beta"];
		});
		await waitForFiles("References", (p) => p.includes("References/hopperBetaReportSync2019.md"), "the clip wasn't filed");
		await waitForNotice(/Beta report.*\.md matches existing hopperBetaReportSync2019; left in the inbox\./);
		await browser.pause(SETTLE);
		expect(await notesWithDoi("10.1234/e2e.beta")).toEqual(["References/hopperBetaReportSync2019.md"]);
		// One of the two clips was filed; the other stays in the inbox for you to delete.
		expect(mdIn(await files("Inbox"))).toHaveLength(1);
	});

	it("doesn't file a clip whose reference note a sync client brought in just before", async function () {
		// Another device already filed the article; its note and a stale clip arrive together,
		// the note first, before Obsidian has indexed it.
		await syncWrite(
			"References/hopperBetaReportSync2019.md",
			'---\ncitekey: hopperBetaReportSync2019\ntype: article\ntitle: Beta report on sync\nauthors:\n  - "[[Grace Hopper]]"\nyear: 2019\ndoi: 10.1234/e2e.beta\nsource: https://example.org/articles/beta\nstatus: shelved\n---\n# Beta report on sync\n'
		);
		await syncWrite("Inbox/Beta report.md", clipNote("Beta report on sync", "https://example.org/articles/beta"));
		await waitForNotice("Beta report.md matches existing hopperBetaReportSync2019; left in the inbox.");
		await browser.pause(SETTLE);
		expect(await notesWithDoi("10.1234/e2e.beta")).toEqual(["References/hopperBetaReportSync2019.md"]);
		expect(mdIn(await files("Inbox"))).toEqual(["Inbox/Beta report.md"]);
	});

	for (const [label, gap] of [
		["within the settle time", 200],
		["slower than the settle time", 2500],
	] as const) {
		it(`files a PDF that arrives in two chunks ${label} once, intact`, async function () {
			const pdf = pdfWithText("Gamma paper on partial files", "Alan Turing", "https://doi.org/10.1234/e2e.gamma");
			const half = Math.floor(pdf.length / 2);
			await syncWrite("Inbox/gamma.pdf", pdf.slice(0, half));
			await browser.pause(gap);
			// Slower than the settle time, Stacks sees the first half on its own and leaves it.
			if (gap > 750) await waitForNotice("Stacks: gamma.pdf looks incomplete (still being copied or synced?); left in the inbox until it is complete.");
			await syncAppend("Inbox/gamma.pdf", pdf.slice(half));

			await waitForFiles("References", (p) => p.includes("References/turingGammaPaperPartial2020.md"), "the PDF wasn't filed", 30000);
			await browser.pause(SETTLE);
			expect(await notesWithDoi("10.1234/e2e.gamma")).toEqual(["References/turingGammaPaperPartial2020.md"]);
			const attachments = (await files("References/attachments")).filter((p) => p !== "References/attachments/porterCreatingSharedValue2011.pdf");
			expect(attachments).toEqual(["References/attachments/turingGammaPaperPartial2020.pdf"]);
			expect(new Uint8Array(await diskRead(attachments[0]))).toEqual(pdf);
			expect(await files("Inbox")).toEqual([]);
			expect((await frontmatter("References/turingGammaPaperPartial2020.md"))?.pdf).toBe("[[turingGammaPaperPartial2020.pdf]]");
		});
	}

	it("processes what reached the inbox while Obsidian was closed when it starts", async function () {
		// Stacks off while the files arrive, then a full restart: at launch the files are
		// already in the vault, as after a sync while the app was closed.
		await browser.executeObsidian(async ({ app }) => {
			await (app as any).plugins.disablePluginAndSave("stacks");
		});
		await syncWrite("Inbox/Delta notes.md", clipNote("Delta notes from a closed vault", "https://example.org/articles/delta"));
		await syncWrite("Inbox/gamma.pdf", pdfWithText("Gamma paper on partial files", "doi:10.1234/e2e.gamma"));
		await browser.pause(1000);
		await browser.reloadObsidian({ plugins: ["stacks", "stacks-e2e-stub"] });

		// Nothing is filed during the first seconds, so a sync client can finish first.
		await browser.pause(1500);
		expect(await files("Inbox")).toEqual(["Inbox/Delta notes.md", "Inbox/gamma.pdf"]);
		await waitForFiles(
			"References",
			(p) => p.includes("References/johnsonDeltaNotesClosed2018.md") && p.includes("References/turingGammaPaperPartial2020.md"),
			"the inbox wasn't processed at startup",
			20000
		);
		await waitForNotice("Stacks: processed 2 of 2 inbox items.");
		expect(await files("Inbox")).toEqual([]);
		expect((await stubLog()).unmatched).toEqual([]);
	});

	it("keeps clips and PDFs in the inbox while offline, and files them on Process inbox now", async function () {
		await setOffline(true);
		const clip = clipNote("Epsilon offline capture", "https://example.org/articles/epsilon");
		const pdf = pdfWithText("Delta notes from a closed vault", "doi:10.1234/e2e.delta");
		await syncWrite("Inbox/Epsilon.md", clip);
		await syncWrite("Inbox/delta.pdf", pdf);
		await waitForNotice("Stacks: couldn't reach the network for Epsilon.md; left in the inbox to retry.");
		await waitForNotice("Stacks: couldn't reach the network for delta.pdf; left in the inbox to retry.");
		await browser.pause(SETTLE);
		// Exactly as they were: not renamed, moved or filled in.
		expect(await files("Inbox")).toEqual(["Inbox/Epsilon.md", "Inbox/delta.pdf"]);
		expect((await diskRead("Inbox/Epsilon.md")).toString("utf8")).toBe(clip);
		expect(new Uint8Array(await diskRead("Inbox/delta.pdf"))).toEqual(pdf);
		expect(mdIn(await files("References"))).toHaveLength(3);

		await setOffline(false);
		await clearNotices();
		await runCommand("process-inbox");
		await waitForNotice("Stacks: processed 2 of 2 inbox items.");
		expect(await files("Inbox")).toEqual([]);
		expect(await notesWithDoi("10.1234/e2e.epsilon")).toEqual(["References/liskovEpsilonOfflineCapture2022.md"]);
		expect(await notesWithDoi("10.1234/e2e.delta")).toEqual(["References/johnsonDeltaNotesClosed2018.md"]);
		expect(new Uint8Array(await diskRead("References/attachments/johnsonDeltaNotesClosed2018.pdf"))).toEqual(pdf);
	});

	it("doesn't overwrite a DOI edited outside Obsidian while a batch lookup is pending", async function () {
		// Automatic completion would look the note up on its own; this test is about the batch.
		await setSettings({ completeOnPropertyEdit: false });
		const note = "References/Zeta draft.md";
		await syncWrite(note, "---\ntitle: Zeta draft\ndoi: 10.1234/e2e.zeta\nstatus: queued\n---\nMy draft notes.\n");
		await waitForFiles("References", (p) => p.includes(note), "the note didn't arrive");
		await waitForIndex();
		await browser.executeObsidian(async ({ app }, path) => {
			await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath(path)!);
			(app as any).plugins.plugins["stacks-e2e-stub"].hold("e2e.zeta");
		}, note);

		await runCommand("batch-edit");
		const modal = browser.$(".modal-container .modal");
		await modal.$(".setting-item-name=Action").parentElement().parentElement().$("select").selectByAttribute("value", "complete");
		await browser.waitUntil(async () => (await modal.getText()).includes("Only Zeta draft: 1 note. 1 will be processed"), { timeoutMsg: "no preview" });
		await modal.$("button=Apply to 1").click();
		await browser.waitUntil(async () => (await stubLog()).requests.some((u) => u.includes("e2e.zeta")), { timeoutMsg: "the lookup didn't start" });

		// While the lookup waits, another device changes the DOI.
		await syncWrite(note, "---\ntitle: Zeta draft\ndoi: 10.1234/e2e.eta\nstatus: queued\n---\nMy draft notes.\n");
		await browser.waitUntil(async () => (await frontmatter(note))?.doi === "10.1234/e2e.eta", { timeoutMsg: "Obsidian didn't see the edit" });
		await browser.executeObsidian(({ app }) => (app as any).plugins.plugins["stacks-e2e-stub"].release("e2e.zeta"));

		await browser.waitUntil(async () => (await modal.getText()).includes("0 changed, 1 failed."), { timeoutMsg: "batch didn't report the conflict" });
		await modal.$("summary=Failed (1)").click();
		await expect(modal).toHaveText(expect.stringContaining(`${note}: changed during lookup`));
		await browser.pause(1000);
		// The note is as the other device left it: not renamed, no citekey, the new DOI.
		expect(await files("References")).toContain(note);
		expect(await frontmatter(note)).toEqual({ title: "Zeta draft", doi: "10.1234/e2e.eta", status: "queued" });
		expect((await diskRead(note)).toString("utf8")).toBe("---\ntitle: Zeta draft\ndoi: 10.1234/e2e.eta\nstatus: queued\n---\nMy draft notes.\n");
	});
});
