import { familyFromFullName } from "../citekey";
import { Fetcher, getJson } from "./http";
import { parseDate, yearOf } from "./dates";
import { ReferenceData, joinTitle, yearFrom } from "./types";

interface OLBook {
	title?: string;
	subtitle?: string;
	authors?: { name: string }[];
	publishers?: { name: string }[];
	publish_date?: string;
	url?: string;
	notes?: string | { value: string };
}

export function parseOpenLibrary(json: Record<string, OLBook> | null, isbn: string): ReferenceData | null {
	const book = json?.[`ISBN:${isbn}`];
	if (!book?.title) return null;
	const authors = (book.authors ?? []).map((a) => a.name);
	return {
		type: "book",
		title: joinTitle(book.title, book.subtitle),
		authors,
		familyNames: authors.map(familyFromFullName),
		date: parseDate(book.publish_date),
		year: yearOf(parseDate(book.publish_date)) ?? yearFrom(book.publish_date),
		publisher: book.publishers?.[0]?.name,
		isbn,
		source: "Open Library",
	};
}

export async function lookupOpenLibrary(fetch: Fetcher, isbn: string): Promise<ReferenceData | null> {
	const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
	return parseOpenLibrary(await getJson<Record<string, OLBook>>(fetch, url), isbn);
}
