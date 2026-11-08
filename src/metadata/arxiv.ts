import { familyFromFullName } from "../citekey";
import { Fetcher } from "./http";
import { ReferenceData, stripTags, yearFrom } from "./types";

function rawTag(xml: string, name: string): string | undefined {
	return xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1];
}

/** Text content of a leaf element; stripTags also decodes XML entities such as &amp;. */
function tag(xml: string, name: string): string | undefined {
	return stripTags(rawTag(xml, name));
}

export function parseArxiv(xml: string, id: string): ReferenceData | null {
	const entry = rawTag(xml, "entry");
	if (!entry) return null;
	const title = tag(entry, "title");
	if (!title || /^Error$/i.test(title)) return null;
	const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => stripTags(m[1]) ?? "").filter(Boolean);
	const doi = tag(entry, "arxiv:doi");
	return {
		type: "paper",
		title,
		authors,
		familyNames: authors.map(familyFromFullName),
		year: yearFrom(tag(entry, "published")),
		journal: tag(entry, "arxiv:journal_ref") ?? "arXiv",
		abstract: tag(entry, "summary"),
		doi,
		url: `https://arxiv.org/abs/${id}`,
		source: "arXiv",
	};
}

/** Old-scheme IDs such as hep-th/9901001 keep their slash in the query. */
export async function lookupArxiv(fetch: Fetcher, id: string): Promise<ReferenceData | null> {
	const res = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id).replace(/%2F/gi, "/")}`);
	return res.status === 200 ? parseArxiv(res.text, id) : null;
}
