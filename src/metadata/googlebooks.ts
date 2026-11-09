import { familyFromFullName } from "../citekey";
import { Fetcher, getJson } from "./http";
import { parseDate, yearOf } from "./dates";
import { ReferenceData, joinTitle, stripTags, yearFrom } from "./types";

interface GBResponse {
	items?: {
		volumeInfo: {
			title?: string;
			subtitle?: string;
			authors?: string[];
			publisher?: string;
			publishedDate?: string;
			description?: string;
		};
	}[];
}

export function parseGoogleBooks(json: GBResponse | null, isbn: string): ReferenceData | null {
	const v = json?.items?.[0]?.volumeInfo;
	if (!v?.title) return null;
	const authors = v.authors ?? [];
	return {
		type: "book",
		title: joinTitle(v.title, v.subtitle),
		authors,
		familyNames: authors.map(familyFromFullName),
		date: parseDate(v.publishedDate),
		year: yearOf(parseDate(v.publishedDate)) ?? yearFrom(v.publishedDate),
		publisher: v.publisher,
		abstract: stripTags(v.description),
		isbn,
		source: "Google Books",
	};
}

export async function lookupGoogleBooks(fetch: Fetcher, isbn: string): Promise<ReferenceData | null> {
	const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;
	return parseGoogleBooks(await getJson<GBResponse>(fetch, url), isbn);
}
