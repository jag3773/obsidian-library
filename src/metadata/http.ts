/** A tiny HTTP abstraction so metadata sources stay testable outside Obsidian. */
export interface HttpResponse {
	status: number;
	text: string;
	/** Response headers, when the fetcher provides them. Names may be in any case. */
	headers?: Record<string, string>;
	/** The raw body, when the fetcher provides it (downloads). */
	body?: ArrayBuffer;
}

export type Fetcher = (url: string, headers?: Record<string, string>) => Promise<HttpResponse>;

/** A response header, matched without regard to case. */
export function header(res: HttpResponse, name: string): string | undefined {
	const want = name.toLowerCase();
	for (const [k, v] of Object.entries(res.headers ?? {})) if (k.toLowerCase() === want) return v;
	return undefined;
}

export async function getJson<T = unknown>(fetch: Fetcher, url: string, headers?: Record<string, string>): Promise<T | null> {
	const res = await fetch(url, { Accept: "application/json", ...headers });
	if (res.status < 200 || res.status >= 300) return null;
	try {
		return JSON.parse(res.text) as T;
	} catch {
		return null;
	}
}
