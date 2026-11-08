import { familyFromFullName } from "../citekey";
import { Fetcher } from "./http";
import { ReferenceData, yearFrom } from "./types";

function tag(xml: string, name: string): string | undefined {
	const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
	return m ? m[1].replace(/\s+/g, " ").trim() : undefined;
}

export function parseArxiv(xml: string, id: string): ReferenceData | null {
	const entry = tag(xml, "entry");
	if (!entry) return null;
	const title = tag(entry, "title");
	if (!title || /^Error$/i.test(title)) return null;
	const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => m[1].trim());
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

export async function lookupArxiv(fetch: Fetcher, id: string): Promise<ReferenceData | null> {
	const res = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
	return res.status === 200 ? parseArxiv(res.text, id) : null;
}
