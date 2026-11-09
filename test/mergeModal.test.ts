// The merge dialog's choice of note to keep, with previews that resolve when the test says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App, Setting, TFile } from "obsidian";
import { Library } from "../src/library";
import { MergePlan } from "../src/maintenance";
import { withDefaults } from "../src/settings";
import { MergeModal } from "../src/ui/MergeModal";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function flush(rounds = 10) {
	for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

const md = (fm: Record<string, unknown>) => `---\n${JSON.stringify(fm)}\n---\n`;
const mergeButtons = () => (Setting as any).all.flatMap((s: any) => s.buttons).filter((b: any) => b.text === "Merge");
const keeperDropdown = () => [...(Setting as any).all].reverse().find((s: any) => s.dropdown).dropdown;

test("changing the note to keep withdraws the old merge plan until the new keeper's preview is ready", async () => {
	(Setting as any).all = [];
	const app = new App();
	const settings = withDefaults({});
	const library = new Library(app as any, () => settings);
	const a = app.vault.addFile("References/a.md", md({ citekey: "a" }));
	const b = app.vault.addFile("References/b.md", md({ citekey: "smith" }));
	const previews: { keep: TFile; drop: TFile; resolve: (p: MergePlan) => void }[] = [];
	const merged: MergePlan[] = [];
	const maintenance = {
		planMerge: (keep: TFile, drop: TFile) => new Promise<MergePlan>((resolve) => previews.push({ keep, drop, resolve })),
		merge: async (plan: MergePlan) => (merged.push(plan), { linksChanged: 0, filesChanged: 0 }),
	};
	const finish = (i: number) => {
		const { keep, drop, resolve } = previews[i];
		resolve({ keep, drop, changes: [], annotationsCopied: false, paragraphsAdded: 0, links: [], dropText: "" });
	};
	const modal = new MergeModal(app as any, library, maintenance as any, { paths: [a.path, b.path], pairs: [] });
	modal.onOpen();
	finish(0);
	await flush();
	const oldMerge = mergeButtons().at(-1);
	assert.equal(oldMerge.disabled, false);

	// Choose b, then a again, then b: the old button no longer merges a's plan.
	keeperDropdown().change(b.path);
	oldMerge.click();
	keeperDropdown().change(a.path);
	keeperDropdown().change(b.path);
	await flush();
	assert.deepEqual(merged, []);
	// A preview for an earlier choice arrives late: ignored, no button for it.
	const buttonsBefore = mergeButtons().length;
	finish(1);
	finish(2);
	await flush();
	assert.equal(mergeButtons().length, buttonsBefore);
	assert.ok(mergeButtons().every((m: any) => m.disabled));
	oldMerge.click();
	await flush();
	assert.deepEqual(merged, []);

	// Once b's preview is in, Merge runs b's plan.
	finish(3);
	await flush();
	mergeButtons().at(-1).click();
	await flush();
	assert.deepEqual(
		merged.map((p) => [p.keep.path, p.drop.path]),
		[[b.path, a.path]]
	);
});
