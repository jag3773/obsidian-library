/** Pure module: the plugin's logical fields. */

/** Logical property keys the plugin reads and writes. Each maps to a real frontmatter name. */
export const PROPERTY_KEYS = [
	"citekey",
	"type",
	"title",
	"authors",
	"year",
	"published",
	"publisher",
	"journal",
	"isbn",
	"doi",
	"url",
	"abstract",
	"status",
	"pdf",
	"attachments",
	"added",
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
	year: "Year",
	published: "Date published",
	publisher: "Publisher",
	journal: "Journal or site",
	isbn: "ISBN",
	doi: "DOI",
	url: "URL",
	abstract: "Abstract",
	status: "Reading status",
	pdf: "PDF",
	attachments: "Attachments",
	added: "Date added",
	highlights: "Highlights",
	lastHighlighted: "Last highlighted",
};

/** The property name each field uses unless the vault maps it elsewhere. */
export const DEFAULT_PROPERTY_NAMES: Record<PropertyKey, string> = {
	...(Object.fromEntries(PROPERTY_KEYS.map((k) => [k, k])) as Record<PropertyKey, string>),
	lastHighlighted: "last_highlighted",
};
