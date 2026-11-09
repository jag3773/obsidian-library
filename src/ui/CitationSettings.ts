import { App, Setting } from "obsidian";
import { CITE_FORMAT_LABELS, CiteFormat } from "../cite";
import type { LibrarySettings } from "../settings";
import { PathSuggest, filePaths } from "./PathSuggest";

/** The citations section of the settings tab: style, locale and how citations are inserted. */
export function displayCitationSettings(app: App, containerEl: HTMLElement, s: LibrarySettings, save: () => Promise<void>): void {
	new Setting(containerEl).setName("Citations").setHeading();
	const path = (name: string, desc: string, ext: string, get: () => string, set: (v: string) => void, placeholder: string) =>
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addSearch((t) => {
				new PathSuggest(app, t.inputEl, () => filePaths(app, [ext]));
				t.setPlaceholder(placeholder)
					.setValue(get())
					.onChange(async (v) => {
						set(v.trim());
						await save();
					});
			});
	path(
		"Citation style",
		"A .csl file in your vault, for formatted citations and bibliographies. Leave empty for the built-in Chicago author-date style. Styles can be downloaded from the Zotero style repository.",
		"csl",
		() => s.citationStyle,
		(v) => (s.citationStyle = v),
		"styles/apa.csl"
	);
	path(
		"Citation locale",
		"Optional. A CSL locale file in your vault, for another language's terms and dates. Leave empty for US English.",
		"xml",
		() => s.citationLocale,
		(v) => (s.citationLocale = v),
		"styles/locales-en-GB.xml"
	);
	new Setting(containerEl)
		.setName("Insert citations as")
		.setDesc("What the insert citation command writes. Links connect the draft to reference notes; Pandoc citations are formatted by Pandoc and Quarto.")
		.addDropdown((d) => {
			for (const [k, label] of Object.entries(CITE_FORMAT_LABELS)) d.addOption(k, label);
			d.setValue(s.citeFormat).onChange(async (v) => {
				s.citeFormat = v as CiteFormat;
				await save();
			});
		});
	new Setting(containerEl)
		.setName("Ask for a page")
		.setDesc("After you pick a reference, ask for an optional page or other locator.")
		.addToggle((t) =>
			t.setValue(s.citeAskLocator).onChange(async (v) => {
				s.citeAskLocator = v;
				await save();
			})
		);
}
