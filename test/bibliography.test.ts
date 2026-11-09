// #19: bibliography export.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App, TFile } from "obsidian";
import { buildBibliography, matchesFilter, parseFilter, render, tex, toBib, toCslJson } from "../src/bibliography";
import { CslItem, noteToCsl } from "../src/citation";
import { writeAtomic } from "../src/export";
import LibraryPlugin from "../src/main";
import { withDefaults } from "../src/settings";

/* eslint-disable @typescript-eslint/no-explicit-any */

const p = withDefaults({}).propertyNames;

const notes = [
	{
		path: "References/porterCreatingSharedValue2011.md",
		frontmatter: {
			citekey: "porterCreatingSharedValue2011",
			type: "article",
			title: "Creating Shared Value: How to Reinvent Capitalism",
			authors: ["[[Michael E. Porter]]", "[[Mark R. Kramer]]"],
			published: "2011-01-15",
			year: 2011,
			journal: "Harvard Business Review",
			volume: "89",
			issue: "1/2",
			pages: "62-77",
			doi: "10.1000/hbr_2011",
			status: "processed",
			collections: ["[[Strategy]]"],
		},
	},
	{
		path: "References/garciamarquezCienAnos1967.md",
		frontmatter: {
			citekey: "garciamarquezCienAnos1967",
			type: "book",
			title: "Cien años de soledad",
			authors: ["[[Gabriel García Márquez|García Márquez, Gabriel]]"],
			translators: ["[[Gregory Rabassa]]"],
			year: 1967,
			publisher: "Editorial Sudamericana",
			place: "Buenos Aires",
			isbn: "9780060883287",
			language: "es",
			status: "queued",
		},
	},
	{
		path: "References/whoReport2020.md",
		frontmatter: {
			citekey: "whoReport2020",
			type: "report",
			title: "R&D 100% {done} #1 $5 a_b ~x^2 \\ok",
			authors: ["{World Health Organization}"],
			year: 2020,
			url: "https://example.org/r?a=1&b_c=2",
			accessed: "2026-11-08",
		},
	},
];

test("CSL-JSON: sorted by citekey, Unicode kept, deterministic", () => {
	const bib = buildBibliography([...notes].reverse(), p);
	assert.deepEqual(bib.items.map((i) => i.id), ["garciamarquezCienAnos1967", "porterCreatingSharedValue2011", "whoReport2020"]);
	const json = toCslJson(bib.items);
	assert.equal(json, toCslJson(buildBibliography(notes, p).items), "same output whatever order the notes come in");
	assert.match(json, /"family": "García Márquez"/);
	const back = JSON.parse(json) as CslItem[];
	assert.deepEqual(back[0].translator, [{ family: "Rabassa", given: "Gregory" }]);
	assert.deepEqual(back[2].author, [{ literal: "World Health Organization" }]);
	assert.equal(back[1].type, "article-journal");
});

test("BibLaTeX: types, names, dates, containers and escaping", () => {
	const out = toBib(buildBibliography(notes, p).items, "biblatex");
	assert.match(out, /@article\{porterCreatingSharedValue2011,\n  author = \{Porter, Michael E\. and Kramer, Mark R\.\},/);
	assert.match(out, /journaltitle = \{Harvard Business Review\}/);
	assert.match(out, /date = \{2011-01-15\}/);
	assert.match(out, /pages = \{62--77\}/);
	assert.match(out, /number = \{1\/2\}/);
	assert.match(out, /doi = \{10\.1000\/hbr_2011\}/, "DOIs are verbatim");
	assert.match(out, /@book\{garciamarquezCienAnos1967,\n  author = \{García Márquez, Gabriel\},\n  translator = \{Rabassa, Gregory\},/);
	assert.match(out, /location = \{Buenos Aires\}/);
	assert.match(out, /langid = \{es\}/);
	assert.match(out, /@report\{whoReport2020,\n  author = \{\{World Health Organization\}\},/);
	assert.match(out, /title = \{\{R\\&D\} 100\\% \\\{done\\\} \\#1 \\\$5 a\\_b \\textasciitilde\{\}x\\textasciicircum\{\}2 \\textbackslash\{\}ok\}/);
	assert.match(out, /url = \{https:\/\/example\.org\/r\?a=1&b_c=2\}/, "URLs are verbatim");
	assert.match(out, /urldate = \{2026-11-08\}/);
});

test("BibTeX: year and month, journal, techreport, and no BibLaTeX-only fields", () => {
	const out = toBib(buildBibliography(notes, p).items, "bibtex");
	assert.match(out, /journal = \{Harvard Business Review\}/);
	assert.match(out, /year = \{2011\},\n  month = \{1\}/);
	assert.match(out, /@techreport\{whoReport2020/);
	assert.match(out, /address = \{Buenos Aires\}/);
	assert.doesNotMatch(out, /translator|urldate|langid|date = /);
});

/** Just enough of a BibTeX reader to check the output reads back: entries, keys and fields. */
function readBib(src: string): Record<string, { type: string; fields: Record<string, string> }> {
	const out: Record<string, { type: string; fields: Record<string, string> }> = {};
	for (const m of src.matchAll(/@(\w+)\{([^,]+),\n([\s\S]*?)\n\}/g)) {
		const fields: Record<string, string> = {};
		for (const f of m[3].matchAll(/^ {2}(\w+) = \{(.*)\},$/gm)) fields[f[1]] = f[2];
		out[m[2]] = { type: m[1], fields };
	}
	return out;
}

const unTex = (s: string) =>
	s
		.replace(/\\textbackslash\{\}/g, "\u0000")
		.replace(/\\textasciitilde\{\}/g, "~")
		.replace(/\\textasciicircum\{\}/g, "^")
		// Grouping braces go first; escaped ones are text.
		.replace(/(?<!\\)[{}]/g, "")
		.replace(/\\([{}&%$#_])/g, "$1")
		.replace(/\u0000/g, "\\");

test("semantic round trip: every note's values read back from BibLaTeX", () => {
	const items = buildBibliography(notes, p).items;
	const bib = readBib(toBib(items, "biblatex"));
	assert.equal(Object.keys(bib).length, items.length);
	for (const n of notes) {
		const f = bib[n.frontmatter.citekey as string].fields;
		assert.equal(unTex(f.title), n.frontmatter.title, n.path);
		const authors = f.author.split(" and ").map((a) => unTex(a));
		assert.equal(authors.length, (n.frontmatter.authors as string[]).length);
	}
	assert.equal(bib.garciamarquezCienAnos1967.fields.author, "García Márquez, Gabriel", "the sort form survives exactly");
});

test("semantic round trip: CSL-JSON re-reads to the same records", () => {
	const items = buildBibliography(notes, p).items;
	assert.deepEqual(JSON.parse(toCslJson(items)), JSON.parse(JSON.stringify(items)));
	for (const n of notes) assert.deepEqual(items.find((i) => i.id === n.frontmatter.citekey), noteToCsl(n.frontmatter, p));
});

test("missing and duplicate citekeys, bad keys and incomplete records are reported", () => {
	const bib = buildBibliography(
		[
			...notes,
			{ path: "References/z/dup.md", frontmatter: { citekey: "PorterCreatingSharedValue2011", type: "article", title: "Copy" } },
			{ path: "References/nokey.md", frontmatter: { title: "No key" } },
			{ path: "References/bad.md", frontmatter: { citekey: "has space", type: "book", title: "B", authors: ["A B"], year: 2000, publisher: "P" } },
			{ path: "References/thin.md", frontmatter: { citekey: "thin", type: "book", title: "Thin" } },
		],
		p
	);
	const by = (path: string) => bib.problems.filter((x) => x.path === path).map((x) => x.problem);
	assert.deepEqual(by("References/z/dup.md"), ["citekey also used by References/porterCreatingSharedValue2011.md; left out"], "case-insensitive, first path wins");
	assert.deepEqual(by("References/nokey.md"), ["no citekey; left out"]);
	assert.deepEqual(by("References/bad.md"), ["citekey has characters BibTeX can't use"]);
	assert.deepEqual(by("References/thin.md"), ["missing author or editor, issued, publisher"]);
	assert.equal(bib.items.length, 5);
});

test("a project bibliography: filter by a property's values, links or plain", () => {
	assert.deepEqual(parseFilter("collections: Strategy, Climate"), { property: "collections", values: ["Strategy", "Climate"] });
	assert.equal(parseFilter("nonsense"), undefined);
	assert.equal(matchesFilter(notes[0].frontmatter, parseFilter("collections: strategy")), true, "[[Strategy]] matches, ignoring case");
	assert.equal(matchesFilter(notes[1].frontmatter, parseFilter("collections: strategy")), false);
	const bib = buildBibliography(notes, p, parseFilter("status: processed, queued"));
	assert.deepEqual(bib.items.map((i) => i.id), ["garciamarquezCienAnos1967", "porterCreatingSharedValue2011"]);
	assert.equal(bib.filtered, 1);
	assert.equal(render([], "biblatex"), "");
});

test("tex escapes every special character once", () => {
	assert.equal(tex("\\{}"), "\\textbackslash{}\\{\\}");
	assert.equal(tex("50% & $3 #1 a_b"), "50\\% \\& \\$3 \\#1 a\\_b");
});

test("atomic writes: temp file then rename, nothing when unchanged, fallback when rename refuses", async () => {
	const app = new App();
	const a = app.vault.adapter;
	assert.equal(await writeAtomic(a as any, "out/lib.json", "one"), true);
	assert.equal(await a.read("out/lib.json"), "one");
	assert.deepEqual(a.writes, ["out/.lib.json.library-tmp"], "the target is only ever replaced whole");
	assert.equal(await writeAtomic(a as any, "out/lib.json", "one"), false);
	assert.equal(a.writes.length, 1, "unchanged output isn't rewritten");
	a.failRename = true;
	assert.equal(await writeAtomic(a as any, "out/lib.json", "two"), true);
	assert.equal(await a.read("out/lib.json"), "two");
	assert.equal(await a.exists("out/.lib.json.library-tmp"), false, "the temp file is cleaned up");
});

async function flush(rounds = 20) {
	for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

test("auto-export: debounced after reference edits, off by default, only for references", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const app = new App();
	const plugin = new LibraryPlugin(app as any, { id: "stacks" } as any);
	(plugin as any).data = { autoExport: true, exportPath: "bib/library.json" };
	await plugin.onload();
	const note = app.vault.addFile("References/k.md", `---\n{"citekey":"k","type":"book","title":"T"}\n---\n`);
	app.metadataCache.trigger("changed", note);
	t.mock.timers.tick(4000);
	app.metadataCache.trigger("changed", note);
	t.mock.timers.tick(4000);
	await flush();
	assert.equal(await app.vault.adapter.exists("bib/library.json"), false, "each change restarts the wait");
	t.mock.timers.tick(1000);
	await flush();
	const written = JSON.parse(await app.vault.adapter.read("bib/library.json"));
	assert.deepEqual(written.map((i: CslItem) => i.id), ["k"]);

	const other = app.vault.addFile("Elsewhere/x.md", `---\n{"citekey":"x"}\n---\n`);
	const before = app.vault.adapter.writes.length;
	app.metadataCache.trigger("changed", other);
	t.mock.timers.tick(6000);
	await flush();
	assert.equal(app.vault.adapter.writes.length, before, "notes outside the references folder don't trigger an export");

	plugin.settings.autoExport = false;
	app.metadataCache.trigger("changed", note);
	t.mock.timers.tick(6000);
	await flush();
	assert.equal(app.vault.adapter.writes.length, before);
	plugin.unload();
});

test("auto-export: a pending export is dropped on unload", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const app = new App();
	const plugin = new LibraryPlugin(app as any, { id: "stacks" } as any);
	(plugin as any).data = { autoExport: true };
	await plugin.onload();
	const note: TFile = app.vault.addFile("References/k.md", `---\n{"citekey":"k"}\n---\n`);
	app.metadataCache.trigger("changed", note);
	plugin.unload();
	t.mock.timers.tick(6000);
	await flush();
	assert.equal(app.vault.adapter.writes.length, 0);
});

test("entries follow citekey order, not file order", () => {
	const bib = buildBibliography(
		[
			{ path: "References/a.md", frontmatter: { citekey: "zeta", title: "Z" } },
			{ path: "References/b.md", frontmatter: { citekey: "alpha", title: "A" } },
		],
		p
	);
	assert.deepEqual(bib.items.map((i) => i.id), ["alpha", "zeta"]);
});

test("auto-export runs only for changes to reference notes", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const app = new App();
	const plugin = new LibraryPlugin(app as any, { id: "stacks" } as any);
	(plugin as any).data = { autoExport: true };
	await plugin.onload();
	let runs = 0;
	const real = plugin.exporter.export.bind(plugin.exporter);
	plugin.exporter.export = async (...a: Parameters<typeof real>) => {
		runs++;
		return real(...a);
	};
	const other = app.vault.addFile("Elsewhere/x.md", `---\n{"citekey":"x"}\n---\n`);
	app.metadataCache.trigger("changed", other);
	t.mock.timers.tick(6000);
	await flush();
	assert.equal(runs, 0);
	const ref = app.vault.addFile("References/r.md", `---\n{"citekey":"r"}\n---\n`);
	app.metadataCache.trigger("changed", ref);
	t.mock.timers.tick(6000);
	await flush();
	assert.equal(runs, 1);
	plugin.unload();
});

test("turning auto-export off drops a pending export", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const app = new App();
	const plugin = new LibraryPlugin(app as any, { id: "stacks" } as any);
	(plugin as any).data = { autoExport: true };
	await plugin.onload();
	let runs = 0;
	const real = plugin.exporter.export.bind(plugin.exporter);
	plugin.exporter.export = async (...a: Parameters<typeof real>) => {
		runs++;
		return real(...a);
	};
	const ref = app.vault.addFile("References/r.md", `---\n{"citekey":"r"}\n---\n`);
	app.metadataCache.trigger("changed", ref);
	plugin.settings.autoExport = false;
	t.mock.timers.tick(6000);
	await flush();
	assert.equal(runs, 0, "rechecked when the timer fires");
	plugin.settings.autoExport = true;
	app.metadataCache.trigger("changed", ref);
	plugin.cancelExport();
	t.mock.timers.tick(6000);
	await flush();
	assert.equal(runs, 0, "cancelled by the setting");
	plugin.unload();
});
