import { App, PluginSettingTab, Setting } from "obsidian";
import { parsePattern } from "./citekey";
import type ReferenceLibraryPlugin from "./main";

/** Logical property keys the plugin reads and writes. Each maps to a real frontmatter name. */
export const PROPERTY_KEYS = [
	"citekey",
	"type",
	"title",
	"authors",
	"year",
	"publisher",
	"journal",
	"isbn",
	"doi",
	"url",
	"status",
	"pdf",
	"attachments",
	"added",
] as const;
export type PropertyKey = (typeof PROPERTY_KEYS)[number];

export interface LibrarySettings {
	referencesFolder: string;
	attachmentsFolder: string;
	inboxFolder: string;
	filenameFormat: string;
	attachmentFilenameFormat: string;
	citekeyPattern: string;
	templatePath: string;
	authorsAsLinks: boolean;
	statuses: string[];
	defaultStatus: string;
	clipStatus: string;
	processInboxAutomatically: boolean;
	completeOnPropertyEdit: boolean;
	urlProperties: string[];
	crossrefMailto: string;
	propertyNames: Record<PropertyKey, string>;
}

export const DEFAULT_SETTINGS: LibrarySettings = {
	referencesFolder: "References",
	attachmentsFolder: "References/attachments",
	inboxFolder: "Inbox",
	filenameFormat: "{{citekey}}",
	attachmentFilenameFormat: "{{citekey}}",
	citekeyPattern: "auth.lower + shorttitle(3, 3) + year",
	templatePath: "",
	authorsAsLinks: true,
	statuses: ["queued", "reading", "reviewing", "processed", "shelved"],
	defaultStatus: "queued",
	clipStatus: "shelved",
	processInboxAutomatically: true,
	completeOnPropertyEdit: true,
	urlProperties: ["url", "source"],
	crossrefMailto: "",
	propertyNames: {
		citekey: "citekey",
		type: "type",
		title: "title",
		authors: "authors",
		year: "year",
		publisher: "publisher",
		journal: "journal",
		isbn: "isbn",
		doi: "doi",
		url: "url",
		status: "status",
		pdf: "pdf",
		attachments: "attachments",
		added: "added",
	},
};

/** Merge saved data over defaults, including the nested property map. */
export function withDefaults(saved: Partial<LibrarySettings> | null | undefined): LibrarySettings {
	const s = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
	s.propertyNames = Object.assign({}, DEFAULT_SETTINGS.propertyNames, saved?.propertyNames ?? {});
	// Guard against hand-edited or corrupted data.json.
	if (!Array.isArray(s.statuses)) s.statuses = [...DEFAULT_SETTINGS.statuses];
	if (!Array.isArray(s.urlProperties)) s.urlProperties = [...DEFAULT_SETTINGS.urlProperties];
	// An empty references folder would make every note in the vault a "reference" that
	// automatic completion could rename and move.
	if (typeof s.referencesFolder !== "string" || !s.referencesFolder.trim() || s.referencesFolder.trim() === "/")
		s.referencesFolder = DEFAULT_SETTINGS.referencesFolder;
	return s;
}

const csv = (v: string) =>
	v
		.split(",")
		.map((x) => x.trim())
		.filter(Boolean);

export class LibrarySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ReferenceLibraryPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		containerEl.empty();

		const text = (name: string, desc: string, get: () => string, set: (v: string) => void, placeholder = "") =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t
						.setPlaceholder(placeholder)
						.setValue(get())
						.onChange(async (v) => {
							set(v.trim());
							await save();
						})
				);
		const toggle = (name: string, desc: string, get: () => boolean, set: (v: boolean) => void) =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addToggle((t) =>
					t.setValue(get()).onChange(async (v) => {
						set(v);
						await save();
					})
				);

		new Setting(containerEl).setName("Folders").setHeading();
		text("References folder", "Where reference notes live. Cannot be the vault root.", () => s.referencesFolder, (v) => (s.referencesFolder = v && v !== "/" ? v : DEFAULT_SETTINGS.referencesFolder), "References");
		text("Attachments folder", "Where PDFs and other files are filed.", () => s.attachmentsFolder, (v) => (s.attachmentsFolder = v));
		text("Inbox folder", "Drop zone for Web Clipper notes and PDFs.", () => s.inboxFolder, (v) => (s.inboxFolder = v), "Inbox");

		new Setting(containerEl).setName("Naming").setHeading();
		new Setting(containerEl)
			.setName("Citekey pattern")
			.setDesc("Better BibTeX-style formula. Terms: auth, authors(n), shorttitle(n, m), veryshorttitle, title, year, \"literal\"; modifiers .lower and .upper.")
			.addText((t) =>
				t.setValue(s.citekeyPattern).onChange(async (v) => {
					try {
						parsePattern(v);
						t.inputEl.removeClass("reference-library-invalid");
						s.citekeyPattern = v.trim();
						await save();
					} catch {
						t.inputEl.addClass("reference-library-invalid");
					}
				})
			);
		text("Note filename format", "Tokens: {{citekey}}, {{title}}, {{year}}, {{author}}.", () => s.filenameFormat, (v) => (s.filenameFormat = v || "{{citekey}}"));
		text("Attachment filename format", "Same tokens. The file extension is kept.", () => s.attachmentFilenameFormat, (v) => (s.attachmentFilenameFormat = v || "{{citekey}}"));

		new Setting(containerEl).setName("Notes").setHeading();
		text("Note template", "Optional template file for the note body. Leave empty for the built-in template.", () => s.templatePath, (v) => (s.templatePath = v), "Templates/Reference.md");
		toggle("Authors as links", "Write authors as [[Name]] so they connect to people notes.", () => s.authorsAsLinks, (v) => (s.authorsAsLinks = v));
		text("Statuses", "Comma-separated, in reading order.", () => s.statuses.join(", "), (v) => (s.statuses = csv(v)));
		text("Default status", "Set on items added by ISBN, DOI or URL.", () => s.defaultStatus, (v) => (s.defaultStatus = v));
		text("Status for web clips", "Set on notes processed from the inbox.", () => s.clipStatus, (v) => (s.clipStatus = v));

		new Setting(containerEl).setName("Automation").setHeading();
		toggle("Process inbox automatically", "Handle new notes and PDFs in the inbox folder as they arrive.", () => s.processInboxAutomatically, (v) => (s.processInboxAutomatically = v));
		toggle(
			"Complete notes on property edit",
			"When a note in the references folder gets an ISBN, DOI or URL and has no citekey, look it up, fill it in and rename it.",
			() => s.completeOnPropertyEdit,
			(v) => (s.completeOnPropertyEdit = v)
		);
		text("URL properties in clipped notes", "Comma-separated property names to read the URL from.", () => s.urlProperties.join(", "), (v) => (s.urlProperties = csv(v)));

		new Setting(containerEl).setName("Lookups").setHeading();
		text(
			"Crossref contact email",
			"Optional. Sent to Crossref as mailto for their polite pool. Nothing is sent when empty.",
			() => s.crossrefMailto,
			(v) => (s.crossrefMailto = v)
		);

		new Setting(containerEl).setName("Property names").setHeading();
		containerEl.createEl("p", {
			text: "Map each field to the property name your vault uses.",
			cls: "setting-item-description",
		});
		for (const key of PROPERTY_KEYS) {
			text(key, "", () => s.propertyNames[key], (v) => (s.propertyNames[key] = v || key));
		}
	}
}
