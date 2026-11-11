// The mobile UI (emulateMobile) and Stacks' mobile code path.
//
// emulateMobile switches Obsidian to its phone UI, but it is still the Electron desktop app:
// Platform.isDesktopApp stays true, and Stacks (rightly) keeps its file-system features there.
// To exercise what Stacks does in the real mobile app, these tests reload Stacks with
// Platform.isDesktopApp set to false, the flag Stacks checks (src/main.ts createHost,
// src/settings.ts), and put it back afterwards. The real Android app is covered by
// wdio.android.conf.mts.
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { after, before, beforeEach, describe, it } from "mocha";
import { obsidianPage } from "wdio-obsidian-service";
import { ROUND_TRIP_COMMANDS, STUB_ID, clipNote, frontmatter, notices, resetLibrary, setSettings, takeConsoleErrors, waitForFiles } from "../../helpers/stacks";

/** Reload Stacks with Platform.isDesktopApp set as given. */
async function reloadStacks(desktopApp: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app, obsidian }, desktop, stubId) => {
			(obsidian.Platform as { isDesktopApp: boolean }).isDesktopApp = desktop;
			const plugins = (app as any).plugins;
			await plugins.disablePlugin("stacks");
			await plugins.enablePlugin("stacks");
			if (!plugins.plugins[stubId].install()) throw new Error("Stacks didn't load");
		},
		desktopApp,
		STUB_ID
	);
}

/** Ids of the Stacks commands the command palette offers now. */
async function paletteCommands(): Promise<string[]> {
	return browser.executeObsidian(({ app }) =>
		(app as any).commands
			.listCommands()
			.map((c: { id: string }) => c.id)
			.filter((id: string) => id.startsWith("stacks:"))
			.map((id: string) => id.slice(7))
	);
}

describe("Mobile", function () {
	let tablet = "";

	before(async function () {
		const platform = await obsidianPage.getPlatform();
		expect(platform.isMobile).toBe(true);
		tablet = await mkdtemp(join(tmpdir(), "stacks-e2e-tablet-"));
		await reloadStacks(false);
		await takeConsoleErrors();
	});

	after(async function () {
		await reloadStacks(true);
	});

	beforeEach(async function () {
		await resetLibrary();
		// A tablet folder and send status shared from a desktop through the settings file.
		await setSettings({ tabletFolder: tablet, sendStatus: "reading" });
	});

	it("loads without the reading round trip", async function () {
		expect(await browser.executeObsidian(({ app }) => (app as any).plugins.plugins.stacks.roundTrip)).toBeNull();
		await browser.executeObsidian(async ({ app }) => {
			await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath("References/porterCreatingSharedValue2011.md")!);
		});
		const offered = await paletteCommands();
		for (const id of ROUND_TRIP_COMMANDS) expect(offered).not.toContain(id);
		// Commands that work on mobile are there.
		expect(offered).toEqual(expect.arrayContaining(["add-reference", "insert-citation", "copy-formatted-citation", "check-library-health", "batch-edit", "process-inbox"]));
		// The shared settings are kept for the desktop.
		expect(await browser.executeObsidian(({ app }) => (app as any).plugins.plugins.stacks.settings.tabletFolder)).toBe(tablet);
	});

	it("doesn't try to send when a note's status changes to the send status", async function () {
		await browser.executeObsidian(async ({ app }) => {
			await app.fileManager.processFrontMatter(app.vault.getFileByPath("References/porterCreatingSharedValue2011.md")!, (fm) => {
				fm.status = "queued";
			});
		});
		await browser.pause(1000);
		await browser.executeObsidian(async ({ app }) => {
			await app.fileManager.processFrontMatter(app.vault.getFileByPath("References/porterCreatingSharedValue2011.md")!, (fm) => {
				fm.status = "reading";
			});
		});
		await browser.pause(3000);
		expect((await frontmatter("References/porterCreatingSharedValue2011.md"))?.status).toBe("reading");
		expect(await readdir(tablet)).toEqual([]);
		expect((await notices()).filter((n) => /send|tablet/i.test(n))).toEqual([]);
		expect(await takeConsoleErrors()).toEqual([]);
	});

	it("hides the desktop-only settings", async function () {
		const names = await browser.executeObsidian(async ({ app }) => {
			const setting = (app as any).setting;
			setting.open();
			setting.openTabById("stacks");
			await new Promise((r) => setTimeout(r, 500));
			const found = Array.from(document.querySelectorAll(".vertical-tab-content .setting-item-name")).map((e) => e.textContent ?? "");
			setting.close();
			return found;
		});
		expect(names).toContain("Extract when a PDF is saved");
		expect(names).not.toContain("Tablet folder");
		expect(names).not.toContain("Pre-extraction command (desktop)");
	});

	it("captures from the inbox", async function () {
		await obsidianPage.write("Inbox/Eta.md", clipNote("Eta mobile capture", "https://example.org/articles/eta"));
		await waitForFiles("References", (p) => p.includes("References/hamiltonEtaMobileCapture2016.md"), "the clip wasn't filed");
		expect(await frontmatter("References/hamiltonEtaMobileCapture2016.md")).toMatchObject({ doi: "10.1234/e2e.eta", status: "shelved" });
		expect(await takeConsoleErrors()).toEqual([]);
	});
});
