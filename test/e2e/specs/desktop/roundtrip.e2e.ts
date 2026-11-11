// Control for the mobile spec: in the desktop app, the same status change that does nothing on
// mobile sends the PDF to the tablet folder.
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { beforeEach, describe, it } from "mocha";
import { resetLibrary, setSettings } from "../../helpers/stacks";

describe("Reading round trip (desktop)", function () {
	let tablet = "";

	beforeEach(async function () {
		await resetLibrary();
		tablet = await mkdtemp(join(tmpdir(), "stacks-e2e-tablet-"));
		await setSettings({ tabletFolder: tablet, sendStatus: "reading" });
	});

	it("sends the PDF when a note's status changes to the send status", async function () {
		await browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getFileByPath("References/porterCreatingSharedValue2011.md")!;
			await app.fileManager.processFrontMatter(file, (fm) => (fm.status = "queued"));
			await new Promise((r) => setTimeout(r, 1000));
			await app.fileManager.processFrontMatter(file, (fm) => (fm.status = "reading"));
		});
		// Written under a temporary name, then renamed, so a sync client never uploads half a file.
		let sent: string[] = [];
		await browser.waitUntil(async () => (sent = await readdir(tablet)).includes("porterCreatingSharedValue2011.pdf"), { timeoutMsg: "nothing was sent" });
		await browser.pause(500);
		expect(await readdir(tablet)).toEqual(["porterCreatingSharedValue2011.pdf"]);
		const offered = await browser.executeObsidian(({ app }) => (app as any).commands.listCommands().map((c: { id: string }) => c.id));
		expect(offered).toContain("stacks:check-tablet-folder");
	});
});
