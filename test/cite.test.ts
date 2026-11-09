// #21: picking references and writing citations into notes; #20: which references a bibliography covers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App, Notice, SuggestModal } from "obsidian";
import {
	CiteRef,
	appendToPandoc,
	citeRef,
	formatCite,
	pandocCitationAt,
	pandocKey,
	pandocKeysIn,
	pandocLocator,
	searchRefs,
	wikilinkTargetsIn,
} from "../src/cite";
import LibraryPlugin from "../src/main";
import { DEFAULT_PROPERTY_NAMES } from "../src/properties";
import numericStyle from "./fixtures/csl/numeric.csl";

/* eslint-disable @typescript-eslint/no-explicit-any */

const REFS: CiteRef[] = [
	{ key: "porterCreatingSharedValue2011", title: "Creating Shared Value", authors: "Porter, Kramer", year: "2011", path: "References/porter.md" },
	{ key: "garciamarquezOneHundredYears1967", title: "One Hundred Years of Solitude", authors: "García Márquez", year: "1967", path: "References/gm.md" },
	{ key: "kramerValue2020", title: "Value", authors: "Kramer", year: "2020", path: "References/k.md" },
];

test("references are found by citekey, title, author and year, accents ignored", () => {
	const keys = (q: string) => searchRefs(REFS, q).map((r) => r.key);
	assert.deepEqual(keys("porter"), ["porterCreatingSharedValue2011"]);
	assert.deepEqual(keys("solitude"), ["garciamarquezOneHundredYears1967"]);
	assert.deepEqual(keys("garcia"), ["garciamarquezOneHundredYears1967"]);
	assert.deepEqual(keys("1967"), ["garciamarquezOneHundredYears1967"]);
	// A citekey prefix outranks an author match.
	assert.deepEqual(keys("kramer"), ["kramerValue2020", "porterCreatingSharedValue2011"]);
	assert.deepEqual(keys("kramer 2011"), ["porterCreatingSharedValue2011"]);
	assert.deepEqual(keys("nothing here"), []);
	// No query: everything, newest first.
	assert.deepEqual(keys(""), ["kramerValue2020", "porterCreatingSharedValue2011", "garciamarquezOneHundredYears1967"]);
});

test("a note's picker entry comes from its properties", () => {
	const ref = citeRef(
		{ citekey: "limaMethod2020", title: "On Method", authors: ["[[Ana Lima]]", "[[World Health Organization]]"], published: "2020-05-01" },
		DEFAULT_PROPERTY_NAMES,
		"References/limaMethod2020.md"
	);
	assert.deepEqual(ref, { key: "limaMethod2020", title: "On Method", authors: "Lima, World Health Organization", year: "2020", path: "References/limaMethod2020.md" });
	assert.equal(citeRef({ title: "No key" }, DEFAULT_PROPERTY_NAMES, "x.md"), undefined);
	// Editors stand in when there are no authors.
	assert.equal(citeRef({ citekey: "k", editors: ["Jane Doe"], year: 2001 }, DEFAULT_PROPERTY_NAMES, "k.md")?.authors, "Doe");
});

test("citation text in each format, with locators and several references", () => {
	const a = { key: "a2020", locator: "12" };
	const b = { key: "b2021", link: "References/b2021" };
	assert.equal(formatCite([a], "pandoc"), "[@a2020, p. 12]");
	assert.equal(formatCite([a, b], "pandoc"), "[@a2020, p. 12; @b2021]");
	assert.equal(formatCite([a], "wikilink"), "[[a2020]], p. 12");
	assert.equal(formatCite([b], "wikilink"), "[[References/b2021|b2021]]");
	assert.equal(formatCite([a, b], "both"), "[@a2020, p. 12; @b2021] [[a2020]] [[References/b2021|b2021]]");
	assert.equal(formatCite([], "pandoc"), "");
});

test("locators and keys as Pandoc reads them", () => {
	assert.equal(pandocLocator("12"), "p. 12");
	assert.equal(pandocLocator("12-14"), "pp. 12-14");
	assert.equal(pandocLocator("chap. 3"), "chap. 3");
	assert.equal(pandocLocator("  "), "");
	assert.equal(pandocKey("doe:2020.x"), "@doe:2020.x");
	assert.equal(pandocKey("odd key"), "@{odd key}");
	assert.equal(pandocKey("trailing."), "@{trailing.}");
});

test("a cursor inside a Pandoc citation is found, so a second key joins it", () => {
	const line = "As shown [@a2020, p. 12] and [see @b].";
	assert.deepEqual(pandocCitationAt(line, 12), { start: 9, end: 23 });
	assert.equal(pandocCitationAt(line, 5), undefined);
	assert.equal(pandocCitationAt("a [[link]] b", 4), undefined);
	assert.equal(appendToPandoc([{ key: "c", locator: "3" }]), "; @c, p. 3");
});

test("citekeys and links a draft cites, in order, skipping emails and code", () => {
	const text = "Intro [@a2020; -@b2021, p. 3] mail me@example.com, see @c2019.\n`@notakey` [[d2018|D]] and @{odd key}.\n```\n@fenced\n```";
	assert.deepEqual(
		pandocKeysIn(text).map((k) => k.key),
		["a2020", "b2021", "c2019", "odd key"]
	);
	assert.deepEqual(wikilinkTargetsIn("x [[a#Heading|A]] ![[b.pdf#page=2]] `[[c]]` [[d]]").map((l) => l.target), ["a", "b.pdf", "d"]);
});

// ---------------------------------------------------------------- in the plugin

async function setup(settings: Record<string, unknown> = {}) {
	const app = new App();
	const plugin = new LibraryPlugin(app as any, { id: "stacks" } as any);
	(plugin as any).data = settings;
	await plugin.onload();
	app.vault.addFile(
		"References/porterCreatingSharedValue2011.md",
		'---\ncitekey: porterCreatingSharedValue2011\ntype: article\ntitle: Creating Shared Value\nauthors: ["[[Michael E. Porter]]", "[[Mark R. Kramer]]"]\nyear: 2011\njournal: Harvard Business Review\nvolume: "89"\n---\n'
	);
	app.vault.addFile(
		"References/hookerLaws1989.md",
		'---\ncitekey: hookerLaws1989\ntype: book\ntitle: Of the Laws of Ecclesiastical Polity\nauthors: ["[[Richard Hooker]]"]\nyear: 1989\npublisher: Cambridge University Press\n---\n'
	);
	app.vault.addFile("References/doeUndated.md", "---\ncitekey: doeUndated\ntype: book\ntitle: Undated Book\nauthors: [Jane Doe]\npublisher: Nowhere Press\n---\n");
	return { app, plugin };
}

/** A one-line editor. */
function editor(text: string, ch: number) {
	const e = {
		text,
		cursor: { line: 0, ch },
		getCursor: () => e.cursor,
		getLine: () => e.text,
		replaceSelection: (s: string) => {
			e.text = e.text.slice(0, e.cursor.ch) + s + e.text.slice(e.cursor.ch);
			e.cursor = { line: 0, ch: e.cursor.ch + s.length };
		},
		replaceRange: (s: string, at: { ch: number }) => {
			e.text = e.text.slice(0, at.ch) + s + e.text.slice(at.ch);
		},
		setCursor: (c: { line: number; ch: number }) => void (e.cursor = c),
	};
	return e;
}

test("insert citation: pick a reference and write it in the configured format", async () => {
	const { plugin } = await setup({ citeFormat: "pandoc" });
	const cmd = (plugin as any).commands.find((c: any) => c.id === "insert-citation");
	assert.ok(cmd.editorCallback, "an editor command");
	const ed = editor("Shared value ", 13);
	SuggestModal.opened.length = 0;
	cmd.editorCallback(ed, { file: { path: "Drafts/essay.md" } });
	const modal = SuggestModal.opened.at(-1) as any;
	assert.equal(modal.pick("porter 2011").key, "porterCreatingSharedValue2011");
	assert.equal(ed.text, "Shared value [@porterCreatingSharedValue2011]");

	// Again with the cursor inside it: the second key joins the same citation.
	ed.cursor = { line: 0, ch: ed.text.length - 1 };
	cmd.editorCallback(ed, { file: { path: "Drafts/essay.md" } });
	(SuggestModal.opened.at(-1) as any).pick("hooker");
	assert.equal(ed.text, "Shared value [@porterCreatingSharedValue2011; @hookerLaws1989]");
});

test("insert citation as both a Pandoc citation and a link", async () => {
	const { plugin } = await setup({ citeFormat: "both" });
	const ed = editor("", 0);
	plugin.citations.insert(ed as any, "Drafts/essay.md");
	(SuggestModal.opened.at(-1) as any).pick("hooker");
	assert.equal(ed.text, "[@hookerLaws1989] [[hookerLaws1989]]");
	ed.cursor = { line: 0, ch: 5 };
	plugin.citations.write(ed as any, [{ key: "doeUndated", locator: "4" }]);
	assert.equal(ed.text, "[@hookerLaws1989; @doeUndated, p. 4] [[doeUndated]] [[hookerLaws1989]]");
});

test("a draft's bibliography: cited references in order, unknown keys reported", async () => {
	const { app, plugin } = await setup();
	const draft = app.vault.addFile("Drafts/essay.md", "First [[hookerLaws1989]], then [@porterCreatingSharedValue2011; @missingKey2000].");
	const scope = await plugin.citations.scopeOf(draft);
	assert.deepEqual(
		scope.files.map((f) => f.basename),
		["hookerLaws1989", "porterCreatingSharedValue2011"]
	);
	assert.deepEqual(scope.missing, ["missingKey2000"]);
});

test("a base's bibliography covers the references in its folder", async () => {
	const { app, plugin } = await setup();
	app.vault.addFile("References/Sub/inner.md", "---\ncitekey: inner2000\ntitle: Inner\n---\n");
	const base = app.vault.addFile("Sub.base", 'filters:\n  and:\n    - file.inFolder("References/Sub")\nviews:\n  - type: table\n    name: T\n');
	const scope = await plugin.citations.scopeOf(base);
	assert.deepEqual(scope.files.map((f) => f.basename), ["inner"]);
	const all = await plugin.citations.scopeOf(app.vault.addFile("All.base", "views:\n  - type: table\n    name: T\n"));
	assert.equal(all.files.length, 4);
});

test("copy formatted bibliography in a style from the vault, reporting incomplete records", async () => {
	const { app, plugin } = await setup({ citationStyle: "styles/numeric.csl" });
	app.vault.adapter.files.set("styles/numeric.csl", numericStyle);
	const copied: string[] = [];
	Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t: string) => void copied.push(t) } }, configurable: true });
	const files = ["References/porterCreatingSharedValue2011.md", "References/doeUndated.md"].map((p) => app.vault.getAbstractFileByPath(p) as any);
	Notice.messages.length = 0;
	await plugin.citations.copy({ files, label: "test", missing: ["gone2001"] }, "bibliography");
	assert.deepEqual(copied, ["[1] M. E. Porter and M. R. Kramer, Creating Shared Value, 2011.\n[2] J. Doe, Undated Book."]);
	const msg = Notice.messages.at(-1) ?? "";
	assert.match(msg, /copied bibliography of 2 references \(Stacks test numeric\)/);
	assert.match(msg, /Not in your library: gone2001/);
	assert.match(msg, /Incomplete: doeUndated: issued/);

	// A missing style file says which setting to fix.
	plugin.settings.citationStyle = "styles/nope.csl";
	await plugin.citations.copy({ files, label: "test", missing: [] }, "citation");
	assert.match(Notice.messages.at(-1) ?? "", /couldn't read the citation style styles\/nope\.csl/);
});

test("citation settings are validated on load", async () => {
	const { plugin } = await setup({ citeFormat: "nonsense", citationStyle: 3 });
	assert.equal(plugin.settings.citeFormat, "pandoc");
	assert.equal(plugin.settings.citationStyle, "");
});
