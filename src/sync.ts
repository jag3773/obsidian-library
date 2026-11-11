/**
 * Helpers that keep inbox processing safe when the network is down and when another device
 * or a sync client is filing the same items. Pure module: no Obsidian imports.
 */

import { Fetcher } from "./metadata/http";

/**
 * Counts what happened to the requests of one lookup. A request that throws got no answer at
 * all (offline, DNS failure, connection refused); one that returns a status, even an error
 * status, reached a server.
 */
export class NetworkTracker {
	responses = 0;
	failures = 0;

	wrap(fetch: Fetcher): Fetcher {
		return async (url, headers) => {
			try {
				const res = await fetch(url, headers);
				this.responses++;
				return res;
			} catch (e) {
				this.failures++;
				throw e;
			}
		};
	}

	/**
	 * True when requests were made and none got an answer: the lookup failed because the
	 * network was unreachable, not because the source had nothing. Such an item should be
	 * retried later rather than filed with less metadata.
	 */
	get unreachable(): boolean {
		return this.failures > 0 && this.responses === 0;
	}
}

/** Byte-for-byte equality. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/**
 * Whether a PDF's bytes end like a whole file: its last 1024 bytes, where PDF readers look,
 * hold the file's closing "startxref <offset> %%EOF", followed by nothing but whitespace. A PDF
 * that a sync client or a file copy is still writing doesn't, even when PDF.js could read its
 * first pages, and even when its content happens to contain the text "%%EOF".
 */
export function looksComplete(bytes: Uint8Array): boolean {
	const tail = bytes.subarray(Math.max(0, bytes.length - 1024));
	// Latin-1 keeps one character per byte, so binary content can't hide or fake the pattern.
	let text = "";
	for (const b of tail) text += String.fromCharCode(b);
	return /startxref[\0\t\n\f\r ]+\d+[\0\t\n\f\r ]+%%EOF[\0\t\n\f\r ]*$/.test(text);
}
