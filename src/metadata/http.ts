/** A tiny HTTP abstraction so metadata sources stay testable outside Obsidian. */
export interface HttpResponse {
	status: number;
	text: string;
}

export type Fetcher = (url: string, headers?: Record<string, string>) => Promise<HttpResponse>;

export async function getJson<T = unknown>(fetch: Fetcher, url: string, headers?: Record<string, string>): Promise<T | null> {
	const res = await fetch(url, { Accept: "application/json", ...headers });
	if (res.status < 200 || res.status >= 300) return null;
	try {
		return JSON.parse(res.text) as T;
	} catch {
		return null;
	}
}
