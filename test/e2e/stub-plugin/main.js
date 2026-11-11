/*
 * Test-only plugin for the Stacks end-to-end tests. Not shipped.
 *
 * Stacks makes every network request through its plugin's request() method (src/main.ts),
 * which calls Obsidian's requestUrl. This plugin replaces request() on the loaded Stacks
 * plugin with a stub that answers from the fixtures below, so the real fetcher, lookup,
 * inbox and batch code all run, and nothing reaches the network. (The "obsidian" module's
 * exports are read-only getters, so requestUrl itself can't be replaced.)
 *
 * - a URL in ROUTES gets its fixture response;
 * - any other URL gets a 404 and is recorded in `unmatched`, so a test can assert that no
 *   unexpected request was made;
 * - with `offline` set, every request throws, as requestUrl does without a network;
 * - `hold(part)` makes requests whose URL contains `part` wait until `release(part)`.
 *
 * It installs the stub when the layout is ready, before Stacks processes the inbox at startup
 * (5 seconds later). Tests reach it with app.plugins.plugins["stacks-e2e-stub"] and call
 * install() again after reloading Stacks.
 */
const obsidian = require("obsidian");

/** Crossref works by DOI. */
const WORKS = {
	"10.1234/e2e.alpha": { title: "Alpha study of inboxes", authors: [["Ada", "Lovelace"]], year: 2021 },
	"10.1234/e2e.beta": { title: "Beta report on sync", authors: [["Grace", "Hopper"]], year: 2019 },
	"10.1234/e2e.gamma": { title: "Gamma paper on partial files", authors: [["Alan", "Turing"]], year: 2020 },
	"10.1234/e2e.delta": { title: "Delta notes from a closed vault", authors: [["Katherine", "Johnson"]], year: 2018 },
	"10.1234/e2e.epsilon": { title: "Epsilon offline capture", authors: [["Barbara", "Liskov"]], year: 2022 },
	"10.1234/e2e.zeta": { title: "Zeta and the pending lookup", authors: [["Edsger", "Dijkstra"]], year: 1968 },
	"10.1234/e2e.eta": { title: "Eta mobile capture", authors: [["Margaret", "Hamilton"]], year: 2016 },
};

/** Web pages a clip can point to; each names its DOI the way publishers do. */
const PAGES = {
	"https://example.org/articles/alpha": "10.1234/e2e.alpha",
	"https://example.org/articles/beta": "10.1234/e2e.beta",
	"https://example.org/articles/delta": "10.1234/e2e.delta",
	"https://example.org/articles/epsilon": "10.1234/e2e.epsilon",
	"https://example.org/articles/eta": "10.1234/e2e.eta",
};

function crossref(doi, w) {
	return {
		status: "ok",
		message: {
			DOI: doi,
			type: "journal-article",
			title: [w.title],
			author: w.authors.map(([given, family]) => ({ given, family })),
			issued: { "date-parts": [[w.year]] },
			"container-title": ["Journal of End-to-End Tests"],
			volume: "1",
			issue: "1",
			page: "1-10",
			publisher: "Test Publisher",
			URL: `https://doi.org/${doi}`,
		},
	};
}

function page(url, doi) {
	const w = WORKS[doi];
	return `<!doctype html><html><head><title>${w.title}</title>
<meta name="citation_title" content="${w.title}">
<meta name="citation_doi" content="${doi}">
<link rel="canonical" href="${url}">
</head><body><h1>${w.title}</h1></body></html>`;
}

function buildRoutes() {
	const routes = {};
	for (const [doi, w] of Object.entries(WORKS))
		routes[`https://api.crossref.org/works/${encodeURIComponent(doi)}`] = { status: 200, type: "application/json", body: JSON.stringify(crossref(doi, w)) };
	for (const [url, doi] of Object.entries(PAGES)) routes[url] = { status: 200, type: "text/html", body: page(url, doi) };
	return routes;
}

function response(status, type, text) {
	const bytes = new TextEncoder().encode(text);
	return {
		status,
		headers: { "content-type": type },
		text,
		arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
		get json() {
			return JSON.parse(text);
		},
	};
}

class StacksE2eStub extends obsidian.Plugin {
	onload() {
		this.offline = false;
		this.requests = [];
		this.unmatched = [];
		this.routes = buildRoutes();
		this.held = {};
		const self = this;
		this.stub = async function requestUrl(req) {
			const url = typeof req === "string" ? req : req.url;
			self.requests.push(url);
			for (const [part, gate] of Object.entries(self.held)) if (url.includes(part)) await gate.promise;
			if (self.offline) throw new Error("net::ERR_INTERNET_DISCONNECTED");
			const route = self.routes[url.split("?")[0]];
			if (!route) {
				self.unmatched.push(url);
				return response(404, "text/plain", "not found");
			}
			return response(route.status, route.type, route.body);
		};
		this.app.workspace.onLayoutReady(() => this.install());
	}

	/** Answer the loaded Stacks plugin's requests from the fixtures. Returns false when Stacks isn't loaded. */
	install() {
		const stacks = this.app.plugins.plugins.stacks;
		if (!stacks) return false;
		stacks.request = this.stub;
		return true;
	}

	/** Requests whose URL contains part wait until release(part). */
	hold(part) {
		let release;
		const promise = new Promise((r) => (release = r));
		this.held[part] = { promise, release };
	}

	release(part) {
		this.held[part]?.release();
		delete this.held[part];
	}

	reset() {
		this.offline = false;
		this.requests = [];
		this.unmatched = [];
		for (const part of Object.keys(this.held)) this.release(part);
	}

	onunload() {
		const stacks = this.app.plugins.plugins.stacks;
		if (stacks && stacks.request === this.stub) delete stacks.request;
	}
}

module.exports = StacksE2eStub;
