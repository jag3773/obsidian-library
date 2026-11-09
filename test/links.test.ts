import { test } from "node:test";
import assert from "node:assert/strict";
import { findLinks, retarget, rewriteLinks } from "../src/links";

test("findLinks reads wikilinks, embeds, subpaths and aliases", () => {
	const links = findLinks("See [[smith2020]], [[smith2020#Method|the method]] and ![[smith2020#^ann-1]].");
	assert.deepEqual(
		links.map((l) => [l.kind, l.embed, l.target, l.subpath, l.display]),
		[
			["wiki", false, "smith2020", "", ""],
			["wiki", false, "smith2020", "#Method", "|the method"],
			["wiki", true, "smith2020", "#^ann-1", ""],
		]
	);
});

test("findLinks reads Markdown links, decoded, and skips external URLs", () => {
	const links = findLinks("[Smith](References/smith%202020.md#Intro) and [web](https://example.org) [mail](mailto:a@b.c)");
	assert.equal(links.length, 1);
	assert.equal(links[0].target, "References/smith 2020.md");
	assert.equal(links[0].subpath, "#Intro");
	assert.equal(links[0].display, "Smith");
});

test("findLinks skips links in code", () => {
	const text = "`[[a]]` and\n\n```\n[[b]]\n```\n\n[[c]]";
	assert.deepEqual(
		findLinks(text).map((l) => l.target),
		["c"]
	);
});

test("findLinks finds links in frontmatter and keeps a table's escaped alias bar", () => {
	const text = '---\nrelated: "[[smith2020]]"\n---\n| a | [[smith2020\\|Smith]] |';
	const links = findLinks(text);
	assert.deepEqual(
		links.map((l) => [l.target, l.display]),
		[
			["smith2020", ""],
			["smith2020", "\\|Smith"],
		]
	);
	assert.equal(retarget(links[1], "jones2020"), "[[jones2020\\|Smith]]");
});

test("retarget keeps embeds, subpaths, aliases and a Markdown link's .md", () => {
	const [wiki, md] = findLinks("![[old#^x|alias]] [text](Old%20name.md#Sec)");
	assert.equal(retarget(wiki, "new"), "![[new#^x|alias]]");
	assert.equal(retarget(md, "References/new name"), "[text](References/new%20name.md#Sec)");
});

test("rewriteLinks changes only the links the predicate picks, and counts them", () => {
	const text = "[[old]] [[other]] [[old|Old]] ![[old]]";
	const r = rewriteLinks(text, (l) => l.target === "old", "new");
	assert.equal(r.text, "[[new]] [[other]] [[new|Old]] ![[new]]");
	assert.equal(r.count, 3);
});
