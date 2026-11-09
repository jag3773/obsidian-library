import { Notice } from "obsidian";
import { DuplicateGroup } from "./duplicates";
import { problemCount } from "./health";
import { Cancelled } from "./library";
import type LibraryPlugin from "./main";
import { Maintenance } from "./maintenance";
import { DuplicatesModal, MergeModal } from "./ui/MergeModal";
import { RepairModal } from "./ui/RepairModal";

const PREFIX = "Stacks";

/** Command names, also quoted in the health report. */
export const MAINTENANCE_COMMANDS = {
	check: "Check library health",
	relink: "Relink PDFs named after citekeys",
	review: "Review duplicate references",
	mergeCurrent: "Merge duplicates of current reference",
};

function report(e: unknown): void {
	if (e instanceof Cancelled) return;
	console.error(`[${PREFIX}]`, e);
	new Notice(`${PREFIX}: ${e instanceof Error ? e.message : String(e)}`);
}

/** The health check, PDF relinking and duplicate merging commands (#26, #28). */
export function registerMaintenanceCommands(plugin: LibraryPlugin): Maintenance {
	const { app } = plugin;
	const maintenance = new Maintenance(app, plugin.library, () => plugin.settings);
	const quoted = Object.fromEntries(Object.entries(MAINTENANCE_COMMANDS).map(([k, v]) => [k, `${PREFIX}: ${v}`])) as typeof MAINTENANCE_COMMANDS;

	const check = async () => {
		const pending = new Notice(`${PREFIX}: checking the library…`, 0);
		try {
			const r = await maintenance.check();
			const file = await maintenance.writeReport(r, quoted);
			await app.workspace.getLeaf(false).openFile(file);
			const n = problemCount(r);
			new Notice(
				`${PREFIX}: ${n ? `${n} ${n === 1 ? "problem" : "problems"} in ${r.checked} notes` : `no problems in ${r.checked} notes`}.${r.repairs.length ? ` ${r.repairs.length} PDF ${r.repairs.length === 1 ? "link" : "links"} can be repaired.` : ""}`
			);
		} catch (e) {
			report(e);
		} finally {
			pending.hide();
		}
	};

	const relink = async () => {
		try {
			const { repairs } = await maintenance.check();
			if (!repairs.length) {
				new Notice(`${PREFIX}: no PDF links to repair.`);
				return;
			}
			new RepairModal(app, repairs, plugin.library.prop("pdf"), (chosen) =>
				void (async () => {
					let done = 0;
					for (const r of chosen) if (await maintenance.applyRepair(r)) done++;
					const skipped = chosen.length - done;
					new Notice(`${PREFIX}: relinked ${done} ${done === 1 ? "PDF" : "PDFs"}.${skipped ? ` ${skipped} skipped because the note changed.` : ""}`);
				})().catch(report)
			).open();
		} catch (e) {
			report(e);
		}
	};

	const review = (group: DuplicateGroup) => new MergeModal(app, plugin.library, maintenance, group).open();

	plugin.addCommand({ id: "check-library-health", name: MAINTENANCE_COMMANDS.check, callback: () => void check() });
	plugin.addCommand({ id: "relink-pdfs", name: MAINTENANCE_COMMANDS.relink, callback: () => void relink() });
	plugin.addCommand({
		id: "review-duplicates",
		name: MAINTENANCE_COMMANDS.review,
		callback: () => {
			const groups = maintenance.duplicateGroups();
			if (!groups.length) {
				new Notice(`${PREFIX}: no duplicates found (same DOI, ISBN or URL, or same title and year).`);
				return;
			}
			new DuplicatesModal(app, groups, review).open();
		},
	});
	plugin.addCommand({
		id: "merge-current-duplicates",
		name: MAINTENANCE_COMMANDS.mergeCurrent,
		checkCallback: (checking) => {
			const file = app.workspace.getActiveFile();
			if (!file || !plugin.library.isReference(file)) return false;
			if (checking) return true;
			const group = maintenance.duplicateGroups().find((g) => g.paths.includes(file.path));
			if (group) review(group);
			else new Notice(`${PREFIX}: no duplicates of ${file.basename} found.`);
			return true;
		},
	});
	return maintenance;
}
