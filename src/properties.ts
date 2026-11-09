/** Pure module: the plugin's logical fields. */

/**
 * Logical property keys the plugin reads and writes. Each maps to a real frontmatter name.
 * A field is written only when its source has a value, so a book never carries empty
 * volume or issue keys. docs/citation-fields.md documents what each holds and how it is
 * exported.
 */
export const PROPERTY_KEYS = [
	"citekey",
	"type",
	"title",
	"authors",
	"editors",
	"translators",
	"contributors",
	"year",
	"published",
	"publisher",
	"place",
	"journal",
	"volume",
	"issue",
	"pages",
	"edition",
	"series",
	"isbn",
	"issn",
	"doi",
	"url",
	"accessed",
	"language",
	"abstract",
	"collections",
	"status",
	"pdf",
	"attachments",
	"added",
	"zotero",
	"highlights",
	"lastHighlighted",
] as const;
export type PropertyKey = (typeof PROPERTY_KEYS)[number];

/** Human names for the fields, shown in settings and written as display names in a starter base. */
export const FIELD_LABELS: Record<PropertyKey, string> = {
	citekey: "Citekey",
	type: "Type",
	title: "Title",
	authors: "Authors",
	editors: "Editors",
	translators: "Translators",
	contributors: "Other contributors",
	year: "Year",
	published: "Date published",
	publisher: "Publisher",
	place: "Place published",
	journal: "Journal, book or site",
	volume: "Volume",
	issue: "Issue",
	pages: "Pages",
	edition: "Edition",
	series: "Series",
	isbn: "ISBN",
	issn: "ISSN",
	doi: "DOI",
	url: "URL",
	accessed: "Date accessed",
	language: "Language",
	abstract: "Abstract",
	collections: "Collections",
	status: "Reading status",
	pdf: "PDF",
	attachments: "Attachments",
	added: "Date added",
	zotero: "Zotero link",
	highlights: "Highlights",
	lastHighlighted: "Last highlighted",
};

/** The property name each field uses unless the vault maps it elsewhere. */
export const DEFAULT_PROPERTY_NAMES: Record<PropertyKey, string> = {
	...(Object.fromEntries(PROPERTY_KEYS.map((k) => [k, k])) as Record<PropertyKey, string>),
	lastHighlighted: "last_highlighted",
};

/** Fields that hold people, as name lists (see src/names.ts). */
export const PEOPLE_KEYS = ["authors", "editors", "translators", "contributors"] as const;
export type PeopleKey = (typeof PEOPLE_KEYS)[number];

/** Plain text fields copied as they are from a source into the note. */
export const TEXT_KEYS = ["publisher", "place", "journal", "volume", "issue", "pages", "edition", "series", "issn", "language", "accessed"] as const;
export type TextKey = (typeof TEXT_KEYS)[number];

