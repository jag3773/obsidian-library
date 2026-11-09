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
