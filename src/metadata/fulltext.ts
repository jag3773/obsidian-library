/**
 * Finding a full-text PDF for a reference: where to look and how to check what comes back.
 * Pure apart from the requests made through the Fetcher; the vault side is src/fulltext.ts.
 *
 * Two sources, both only on request (the Find PDF command):
 *   - Unpaywall, by DOI. Its API requires a contact email.
 *   - The work's landing page (the DOI's, or the note's URL), through its citation_pdf_url tag.
 */
import { parseHtml } from "./html";
import { Fetcher, HttpResponse, header } from "./http";
import { isBlockPage, readMeta } from "./webpage";

export interface PdfCandidate {
	url: string;
	/** "Unpaywall" or "Landing page". */
	source: string;
	/** Unpaywall's host_type: "publisher" or "repository". */
	hostType?: string;
	/** Unpaywall's version: "publishedVersion", "acceptedVersion" or "submittedVersion". */
	version?: string;
	license?: string;
	/** Repository or site name, when known. */
	host?: string;
}

const VERSIONS: Record<string, string> = {
	publishedVersion: "published version",
	acceptedVersion: "accepted manuscript",
	submittedVersion: "submitted manuscript (preprint)",
};

/** "Unpaywall: repository, accepted manuscript, cc-by (europepmc.org)". */
export function describeCandidate(c: PdfCandidate): string {
	let host = c.host;
	if (!host) {
		try {
			host = new URL(c.url).hostname;
		} catch {
			host = undefined;
		}
	}
	const details = [c.hostType, c.version ? VERSIONS[c.version] ?? c.version : undefined, c.license].filter(Boolean);
	return `${c.source}${details.length ? `: ${details.join(", ")}` : ""}${host ? ` (${host})` : ""}`;
}

const httpUrl = (v: unknown): string | undefined => {
	if (typeof v !== "string" || !/^https?:\/\//i.test(v.trim())) return undefined;
	try {
		return new URL(v.trim()).href;
	} catch {
		return undefined;
	}
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

interface UnpaywallLocation {
	url_for_pdf?: unknown;
	host_type?: unknown;
	version?: unknown;
	license?: unknown;
	repository_institution?: unknown;
}

/** PDF locations in an Unpaywall record: the best one first, without repeats. */
export function parseUnpaywall(json: unknown): PdfCandidate[] {
	if (!json || typeof json !== "object") return [];
	const rec = json as { best_oa_location?: UnpaywallLocation | null; oa_locations?: UnpaywallLocation[] };
	const locations = [rec.best_oa_location, ...(Array.isArray(rec.oa_locations) ? rec.oa_locations : [])].slice(0, 50);
	const out: PdfCandidate[] = [];
	for (const loc of locations) {
		if (!loc || typeof loc !== "object") continue;
		const url = httpUrl(loc.url_for_pdf);
		if (!url || out.some((c) => c.url === url)) continue;
		out.push({
			url,
			source: "Unpaywall",
			hostType: str(loc.host_type),
			version: str(loc.version),
			license: str(loc.license),
			host: str(loc.repository_institution),
		});
	}
	return out;
}

/**
 * The PDF a landing page links in its citation_pdf_url tag (Highwire, read by Google
 * Scholar). Only an absolute http(s) URL: after redirects the page's real address is unknown.
 */
export function pdfUrlFromPage(html: string): string | undefined {
	const meta = readMeta(parseHtml(html));
	return (meta.get("citation_pdf_url") ?? []).map(httpUrl).find(Boolean);
}

/** The body starts like a PDF: "%PDF-" within the first kilobyte, as readers allow. */
export function hasPdfMagic(bytes: ArrayBuffer | undefined): boolean {
	if (!bytes || bytes.byteLength < 5) return false;
	const head = new Uint8Array(bytes, 0, Math.min(1024, bytes.byteLength));
	for (let i = 0; i + 5 <= head.length; i++)
		if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true;
	return false;
}

/** Why a response isn't a PDF, or undefined when it is one. */
export function notPdfReason(res: HttpResponse): string | undefined {
	if (res.status < 200 || res.status >= 300) return `the server answered ${res.status}`;
	const type = (header(res, "content-type") ?? "").split(";")[0].trim().toLowerCase();
	// Publishers serve sign-in pages and bot checks as HTML in place of the PDF.
	if (type && !/^(application\/(pdf|x-pdf|octet-stream|force-download|download)|binary\/octet-stream)$/.test(type)) return `the server sent ${type}, not a PDF`;
	if (!hasPdfMagic(res.body)) return "the file isn't a PDF";
	return undefined;
}

const MAX_REDIRECTS = 5;

/**
 * GET url, following redirects the fetcher hands back (Obsidian's requestUrl usually follows
 * them itself) to http(s) locations only, at most five.
 */
export async function follow(fetch: Fetcher, url: string, headers: Record<string, string>): Promise<HttpResponse> {
	let current = url;
	for (let i = 0; ; i++) {
		const res = await fetch(current, headers);
		const location = res.status >= 300 && res.status < 400 ? header(res, "location") : undefined;
		if (!location) return res;
		if (i >= MAX_REDIRECTS) throw new Error("too many redirects");
		let next: URL;
		try {
			next = new URL(location, current);
		} catch {
			throw new Error("a redirect to an invalid address");
		}
		if (next.protocol !== "https:" && next.protocol !== "http:") throw new Error("a redirect away from the web");
		current = next.href;
	}
}

export interface PdfSearch {
	candidates: PdfCandidate[];
	/** What each source said when it had nothing, for the person to read. */
	notes: string[];
}

/**
 * Where a PDF of the work may be. Unpaywall is asked only with a DOI and a contact email;
 * the landing page is the DOI's (through doi.org), or else the note's URL.
 */
export async function findPdfCandidates(fetch: Fetcher, work: { doi?: string; url?: string }, email: string): Promise<PdfSearch> {
	const candidates: PdfCandidate[] = [];
	const notes: string[] = [];
	const add = (c: PdfCandidate) => {
		if (!candidates.some((x) => x.url === c.url)) candidates.push(c);
	};
	const mail = email.trim();
	if (work.doi && mail) {
		try {
			const res = await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(work.doi)}?email=${encodeURIComponent(mail)}`, { Accept: "application/json" });
			if (res.status === 404) notes.push("Unpaywall doesn't know this DOI.");
			else if (res.status < 200 || res.status >= 300) notes.push(`Unpaywall answered ${res.status}.`);
			else {
				const found = parseUnpaywall(JSON.parse(res.text));
				if (!found.length) notes.push("Unpaywall knows no open-access PDF for this DOI.");
				found.forEach(add);
			}
		} catch (e) {
			notes.push(`Unpaywall couldn't be reached (${e instanceof Error ? e.message : String(e)}).`);
		}
	} else if (work.doi) notes.push("Unpaywall was skipped: it needs a contact email (Settings → Lookups).");

	const landing = work.doi ? `https://doi.org/${encodeURI(work.doi)}` : httpUrl(work.url);
	if (landing) {
		try {
			const res = await follow(fetch, landing, { Accept: "text/html,application/xhtml+xml" });
			const pdf = res.status >= 200 && res.status < 300 && !isBlockPage(res.text) ? pdfUrlFromPage(res.text) : undefined;
			if (pdf) add({ url: pdf, source: "Landing page" });
			else notes.push(res.status >= 200 && res.status < 300 ? "The landing page links no PDF." : `The landing page answered ${res.status}.`);
		} catch (e) {
			notes.push(`The landing page couldn't be read (${e instanceof Error ? e.message : String(e)}).`);
		}
	}
	return { candidates, notes };
}

/** Download a candidate and check it is a PDF. */
export async function downloadPdf(fetch: Fetcher, url: string): Promise<{ bytes: ArrayBuffer } | { error: string }> {
	let res: HttpResponse;
	try {
		res = await follow(fetch, url, { Accept: "application/pdf,*/*;q=0.5" });
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
	const why = notPdfReason(res);
	return why ? { error: why } : { bytes: res.body! };
}
