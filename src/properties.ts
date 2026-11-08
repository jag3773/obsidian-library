/** Pure module: the plugin's logical fields. */

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
