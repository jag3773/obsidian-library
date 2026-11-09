import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, stringify } from "yaml";
import { baseDisplayNames, baseFolder, basePropertyNames, matchProperties, starterBase, validateBase } from "../src/bases";
import { PROPERTY_KEYS } from "../src/properties";

const README_BASE = `
filters:
  and:
    - file.inFolder("References")
    - file.hasProperty("citekey")
formulas:
  name: file.asLink(title)
  pdf_icon: 'if(pdf, link(pdf.toString()), "")'
properties:
  formula.name:
    displayName: Title
views:
  - type: table
    name: Library
    groupBy:
      property: status
      direction: ASC
    order: [formula.name, authors, year, type, formula.pdf_icon]
  - type: table
    name: Queue
    filters: 'status == "queued"'
    order: [formula.name, authors, year, added]
`;

test("reads property names from properties, columns, groupings, sorts and filters", () => {
	const config = parse(README_BASE);
	assert.deepEqual(basePropertyNames(config).sort(), ["added", "authors", "citekey", "status", "type", "year"]);
});

test("note. prefixes are removed and file./formula./this. ids are skipped", () => {
	const config = {
		properties: { "note.Author": {}, "file.name": {}, "formula.x": {} },
		views: [{ type: "table", order: ["note.Date Published", "file.mtime", "this.file"], sort: [{ property: "note.rating" }] }],
		filters: { or: ['note["Item Type"] == "book"', 'note.Status != "done"', { not: ["file.ext == 'pdf'"] }] },
	};
	assert.deepEqual(basePropertyNames(config), ["Author", "Date Published", "rating", "Item Type", "Status"]);
});

test("finds the base's folder", () => {
	assert.equal(baseFolder(parse(README_BASE)), "References");
	assert.equal(baseFolder({}), null);
	assert.equal(baseFolder({ filters: 'file.inFolder("A") && file.ext == "md"' }), "A");
	assert.equal(baseFolder({ filters: { and: ['file.inFolder("A")', 'file.inFolder("A/B")'] } }), "A/B", "nested resolves to deepest");
	assert.equal(baseFolder({ filters: { and: ['file.inFolder("A")', 'file.inFolder("C")'] } }), null, "conflicting folders");
});

// PR #14 review: only a required, positive inFolder is a destination.
test("negated or alternative folders are not destinations", () => {
	assert.equal(baseFolder({ filters: { not: ['file.inFolder("Archive")'] } }), null);
	assert.equal(baseFolder({ filters: '!file.inFolder("Archive")' }), null);
	assert.equal(baseFolder({ filters: { or: ['file.inFolder("A")', "file.inFolder('B/C')"] } }), null);
	assert.equal(baseFolder({ filters: 'file.inFolder("A") || file.hasTag("x")' }), null);
	assert.equal(baseFolder({ filters: { or: ['file.inFolder("A")', 'file.inFolder("A/B")'] } }), null, "either folder, so neither is required");
	assert.equal(baseFolder({ filters: { or: ['file.inFolder("A")', 'type == "book"'] } }), null, "only one branch mentions a folder");
	assert.equal(baseFolder({ filters: { and: ['file.inFolder("Lib")', { not: ['file.inFolder("Lib/Archive")'] }] } }), "Lib");
	assert.equal(baseFolder({ filters: { or: ['file.inFolder("Lib") && x == 1', 'file.inFolder("Lib") && y == 2'] } }), "Lib", "required by every alternative");
});

// PR #14 review: quoted literals keep apostrophes and escapes.
test("folder literals keep apostrophes and escaped quotes", () => {
	assert.equal(baseFolder({ filters: `file.inFolder("Reader's Library")` }), "Reader's Library");
	assert.equal(baseFolder({ filters: `file.inFolder('Reader\\'s Library')` }), "Reader's Library");
	assert.equal(baseFolder({ filters: `file.inFolder("Say \\"hi\\"")` }), 'Say "hi"');
	assert.equal(baseFolder({ filters: `file.inFolder("A && B") && file.ext == "md"` }), "A && B", "operators inside strings don't split");
	assert.deepEqual(basePropertyNames({ filters: `note["Reader's Status"] == "x" && file.hasProperty("it's")` }), ["Reader's Status", "it's"]);
});

// PR #14 review: wrong-shaped YAML is rejected with a reason.
test("validateBase rejects documents that aren't Bases", () => {
	assert.equal(validateBase(parse(README_BASE)), null);
	assert.equal(validateBase({}), null);
	for (const [doc, reason] of [
		["not a Base", /isn't a Base/],
		[null, /isn't a Base/],
		[[1, 2], /isn't a Base/],
		[{ views: {} }, /views must be a list/],
		[{ views: [3] }, /views\[0\] must be a mapping/],
		[{ views: [{ order: "nope" }] }, /order must be a list/],
		[{ views: [{ sort: [1] }] }, /sort must be a list of mappings/],
		[{ filters: 42 }, /filters must be/],
		[{ filters: { and: "x" } }, /must be a list/],
		[{ filters: { maybe: [] } }, /exactly one of and, or, not/],
		[{ properties: [] }, /properties must be a mapping/],
	] as [unknown, RegExp][]) {
		assert.match(validateBase(doc) ?? "", reason, JSON.stringify(doc));
	}
});

test("fields match exact names first, then synonyms, each name used once", () => {
	const m = matchProperties(["Citation Key", "Title", "author", "date", "source", "url", "DOI", "state", "itemType"]);
	assert.equal(m.citekey, "Citation Key");
	assert.equal(m.title, "Title");
	assert.equal(m.authors, "author");
	assert.equal(m.published, "date", "a date property holds the publication date");
	assert.equal(m.year, "year");
	assert.equal(m.abstract, "abstract");
	assert.equal(m.url, "url", "exact name wins over the synonym source");
	assert.equal(m.journal, "journal", "source is never taken as the journal");
	assert.equal(m.doi, "DOI");
	assert.equal(m.status, "state");
	assert.equal(m.type, "itemType");
	assert.equal(m.isbn, "isbn", "unmatched fields keep the default name");
	const used = PROPERTY_KEYS.map((k) => m[k]);
	assert.equal(new Set(used).size, used.length);
});

test("a vault using source for the URL gets it mapped to url", () => {
	const m = matchProperties(["title", "source", "author"]);
	assert.equal(m.url, "source");
	assert.equal(m.journal, "journal");
});

// PR #14 review: expressions are quoted at the YAML layer.
test("the starter base round-trips through YAML with awkward names", () => {
	const names = matchProperties(["Citation Key", "Title", "author", "date", "state", "itemType", "created"]);
	names.status = "Reader's Status";
	names.title = "name: full";
	for (const folder of ["My Library/Refs", "Research: Papers", "Reader's Library", '"Quoted" #1']) {
		const config = parse(stringify(starterBase(folder, names)));
		assert.equal(validateBase(config), null, folder);
		assert.equal(typeof config.filters.and[0], "string");
		assert.equal(baseFolder(config), folder, folder);
		assert.equal(config.formulas.name, `file.asLink(note[${JSON.stringify("name: full")}])`);
		assert.equal(config.views[1].filters, `note[${JSON.stringify("Reader's Status")}] == "queued"`);
	}
});

// PR #14 review: a starter base reads back to the exact mapping it was made from.
test("reading a starter base back recovers every custom mapping", () => {
	const names = matchProperties([]);
	Object.assign(names, { title: "name", url: "source", doi: "digitalId", isbn: "bookNumber", publisher: "imprint", pdf: "scan", citekey: "Citation Key" });
	const config = parse(stringify(starterBase("Lib", names)));
	const again = matchProperties(basePropertyNames(config), baseDisplayNames(config));
	assert.deepEqual(again, names);
});

test("Web Clipper's published and description properties are recognized", () => {
	const m = matchProperties(["title", "source", "author", "published", "created", "description", "tags"]);
	assert.equal(m.published, "published");
	assert.equal(m.abstract, "description");
	assert.equal(m.authors, "author");
	assert.equal(m.url, "source");
	assert.equal(m.added, "created");
	assert.equal(m.year, "year", "the year isn't taken from a full date property");
});
