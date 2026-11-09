/**
 * Pure module: references made by hand (#16), with no lookup, and the field-by-field
 * comparison used to refresh a note from a fresh lookup without overwriting anything silently.
 */
import { detectIdentifier } from "./identifiers";
import { parseDate, yearOf } from "./metadata/dates";
import { ReferenceData, citekeyFamilies } from "./metadata/types";
import { displayName, familyOf, parseName } from "./names";

/** Item types offered for a manual reference, with labels. */
export const MANUAL_TYPES: Record<string, string> = {
	book: "Book",
	chapter: "Book chapter",
	article: "Article",
	paper: "Conference paper",
	report: "Report",
	thesis: "Thesis",
	document: "Document",
	presentation: "Talk or sermon",
	audio: "Audio or podcast",
	video: "Video",
	webpage: "Web page",
	reference: "Reference entry",
	image: "Image",
};

export interface ManualInput {
	type: string;
	title: string;
	/** One name per line or separated by ";": "Jane Doe", "Doe, Jane" or "{Organization}". */
	authors: string;
	/** A year or a full date, in any common form. */
	date: string;
	/** Optional ISBN, DOI, arXiv ID or URL, stored as is (no lookup). */
	identifier: string;
}

/** The reference a manual form describes, or the reason it can't be made yet. */
export function manualReference(input: ManualInput): { data?: ReferenceData; error?: string } {
	const title = input.title.replace(/\s+/g, " ").trim();
	if (!title) return { error: "Give the reference a title." };
	const names = input.authors
		.split(/\n|;/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map(parseName)
		.filter((n) => n.literal || n.family);
	const date = parseDate(input.date.trim() || undefined);
	if (input.date.trim() && !date) return { error: `"${input.date.trim()}" isn't a date or year.` };
	const data: ReferenceData = {
		type: MANUAL_TYPES[input.type] ? input.type : "document",
		title,
		authors: names.map(displayName),
		familyNames: citekeyFamilies(names.map(familyOf), [], (n) => n),
		names: { authors: names },
		date,
		year: yearOf(date),
		source: "manual entry",
	};
	const raw = input.identifier.trim();
	if (raw) {
		const id = detectIdentifier(raw);
		if (!id) return { error: `"${raw}" doesn't look like an ISBN, DOI, arXiv ID or URL.` };
		if (id.kind === "isbn") data.isbn = id.value;
		else if (id.kind === "doi") data.doi = id.value;
		else if (id.kind === "arxiv") data.url = `https://arxiv.org/abs/${id.value}`;
		else data.url = id.value;
	}
	return { data };
}

export interface FieldChange {
	/** The note's property name. */
	property: string;
	/** The field's label, for display. */
	label: string;
	current: unknown;
	proposed: unknown;
	/** True when the note has no value yet: filling it in loses nothing. */
	fills: boolean;
}

const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.some((x) => x !== null && x !== ""));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || String(a ?? "") === String(b ?? "");

/**
 * The properties a fresh lookup would change, in field order. `fields` maps property names
 * to labels; only those are compared, so citekey, status and dates added are never touched.
 */
export function compareProperties(current: Record<string, unknown>, proposed: Record<string, unknown>, fields: [string, string][]): FieldChange[] {
	const out: FieldChange[] = [];
	for (const [property, label] of fields) {
		const next = proposed[property];
		if (empty(next) || same(current[property], next)) continue;
		out.push({ property, label, current: current[property], proposed: next, fills: empty(current[property]) });
	}
	return out;
}
