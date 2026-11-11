// Runs on desktop, emulated mobile and Android.
import { browser, expect } from "@wdio/globals";
import { before, describe, it } from "mocha";
import { obsidianPage } from "wdio-obsidian-service";
import { RELEASE_COMMANDS, ROUND_TRIP_COMMANDS, resetLibrary } from "../../helpers/stacks";

describe("Stacks loads", function () {
	before(async function () {
		await resetLibrary();
	});

	it("is enabled and has loaded its settings", async function () {
		const state = await browser.executeObsidian(({ app }) => {
			const plugins = (app as any).plugins;
			const stacks = plugins.plugins.stacks;
			return {
				enabled: plugins.enabledPlugins.has("stacks"),
				referencesFolder: stacks?.settings?.referencesFolder,
				inboxFolder: stacks?.settings?.inboxFolder,
			};
		});
		expect(state).toEqual({ enabled: true, referencesFolder: "References", inboxFolder: "Inbox" });
	});

	it("registers the commands of the release", async function () {
		const names = await browser.executeObsidian(({ app }) => {
			const commands = (app as any).commands.commands as Record<string, { name: string }>;
			return Object.fromEntries(Object.entries(commands).filter(([id]) => id.startsWith("stacks:")).map(([id, c]) => [id.slice(7), c.name]));
		});
		for (const [id, name] of Object.entries(RELEASE_COMMANDS)) expect(names[id]).toBe(`Stacks: ${name}`);
	});

	it("offers the reading round trip only on desktop", async function () {
		const platform = await obsidianPage.getPlatform();
		const state = await browser.executeObsidian(({ app }, ids) => {
			const commands = (app as any).commands.commands as Record<string, unknown>;
			return { commands: ids.filter((id) => `stacks:${id}` in commands), roundTrip: (app as any).plugins.plugins.stacks.roundTrip !== null };
		}, ROUND_TRIP_COMMANDS);
		// Registered everywhere, but on mobile there is no round trip, so the commands never show up
		// in the palette (checked in the mobile spec).
		expect(state.roundTrip).toBe(platform.isDesktopApp);
		expect(state.commands).toEqual(ROUND_TRIP_COMMANDS);
	});
});
