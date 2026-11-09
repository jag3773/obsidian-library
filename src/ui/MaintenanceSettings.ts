import { Setting } from "obsidian";
import type LibraryPlugin from "../main";

/** The health check's settings, in their own section of the settings tab. */
export function displayMaintenanceSettings(containerEl: HTMLElement, plugin: LibraryPlugin): void {
	const s = plugin.settings;
	new Setting(containerEl).setName("Health check").setHeading();
	new Setting(containerEl)
		.setName("Report items in one status for more than")
		.setDesc("Days. Counted from the note's last change, or its date added if later. 0 turns this check off.")
		.addText((t) =>
			t
				.setPlaceholder("365")
				.setValue(String(s.healthStaleDays))
				.onChange(async (v) => {
					const n = Number(v.trim());
					const ok = v.trim() !== "" && Number.isInteger(n) && n >= 0;
					t.inputEl.toggleClass("stacks-invalid", !ok);
					if (!ok) return;
					s.healthStaleDays = n;
					await plugin.saveSettings();
				})
		);
	new Setting(containerEl)
		.setName("Statuses to watch")
		.setDesc("Comma-separated. Leave empty to watch every status.")
		.addText((t) =>
			t
				.setPlaceholder("queued, reading, reviewing")
				.setValue(s.healthStaleStatuses.join(", "))
				.onChange(async (v) => {
					s.healthStaleStatuses = v
						.split(",")
						.map((x) => x.trim())
						.filter(Boolean);
					await plugin.saveSettings();
				})
		);
}
