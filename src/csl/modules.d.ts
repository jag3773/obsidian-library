// Bundled CSL files are imported as text (see the loader in esbuild.config.mjs).
declare module "*.csl" {
	const xml: string;
	export default xml;
}
declare module "*.xml" {
	const xml: string;
	export default xml;
}

/** The parts of citeproc-js (npm "citeproc") Stacks uses. */
declare module "citeproc" {
	interface CiteprocSys {
		retrieveLocale(lang: string): string | undefined;
		retrieveItem(id: string): unknown;
	}
	interface CiteprocCite {
		id: string;
		locator?: string;
		label?: string;
		prefix?: string;
		suffix?: string;
		"suppress-author"?: boolean;
	}
	interface CiteprocBibParams {
		bibstart: string;
		bibend: string;
		entry_ids: string[][];
	}
	class Engine {
		constructor(sys: CiteprocSys, style: string, lang?: string, forceLang?: boolean);
		opt: { xclass: string; "default-locale": string[] };
		setOutputFormat(format: "html" | "text" | "rtf"): void;
		updateItems(ids: string[]): void;
		makeBibliography(): [CiteprocBibParams, string[]] | false;
		makeCitationCluster(cites: CiteprocCite[]): string;
	}
	const CSL: { Engine: typeof Engine };
	export default CSL;
	export type { CiteprocSys, CiteprocCite, Engine };
}
