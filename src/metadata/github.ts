import { familyFromFullName } from "../citekey";
import { parseDate, yearOf } from "./dates";
import { Fetcher, getJson } from "./http";
import { githubRepo } from "./sites";
import { ReferenceData } from "./types";

interface GHRepo {
	name?: string;
	full_name?: string;
	description?: string | null;
	html_url?: string;
	created_at?: string;
	owner?: { login?: string; type?: string };
}

interface GHUser {
	login?: string;
	name?: string | null;
}

/**
 * A repository as software: its name, the owner (by display name when set), the date it
 * was created, and its description. Same choices as Zotero's GitHub translator, except the
 * date: Zotero uses the last update, which changes with every push.
 */
export function parseGitHubRepo(repo: GHRepo | null, owner: GHUser | null): ReferenceData | null {
	if (!repo?.name) return null;
	const login = repo.owner?.login;
	const author = owner?.name?.trim() || login;
	const date = parseDate(repo.created_at);
	const url = repo.html_url && /^https:\/\/github\.com\//.test(repo.html_url) ? repo.html_url : undefined;
	return {
		type: "software",
		title: repo.name,
		authors: author ? [author] : [],
		// A person's family name, or an organization's whole name, for citekeys.
		familyNames: author ? [owner?.name?.trim() && repo.owner?.type !== "Organization" ? familyFromFullName(author) : author] : [],
		date,
		year: yearOf(date),
		journal: "GitHub",
		url,
		abstract: repo.description?.trim() || undefined,
		source: "GitHub",
	};
}

/** Look up a repository through GitHub's public API (60 requests an hour without a token). */
export async function lookupGitHub(fetch: Fetcher, url: string): Promise<ReferenceData | null> {
	const r = githubRepo(url);
	if (!r) return null;
	const api = "https://api.github.com";
	const headers = { Accept: "application/vnd.github+json" };
	const repo = await getJson<GHRepo>(fetch, `${api}/repos/${r.owner}/${encodeURIComponent(r.repo)}`, headers);
	if (!repo?.name) return null;
	const login = repo.owner?.login;
	const owner = login && /^[A-Za-z0-9-]+$/.test(login) ? await getJson<GHUser>(fetch, `${api}/users/${login}`, headers).catch(() => null) : null;
	return parseGitHubRepo(repo, owner);
}
