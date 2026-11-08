import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { baseFolders, basePropertyNames, matchProperties, starterBase } from "../src/bases";
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

test("odd or hostile base content doesn't throw", () => {
	for (const c of [{}, { views: [null, 3, "x", { order: "nope" }] }, { filters: 42 }, { properties: [] as unknown as Record<string, unknown> }]) {
		assert.doesNotThrow(() => basePropertyNames(c));
		assert.doesNotThrow(() => baseFolders(c));
	}
});

test("finds the base's folder", () => {
	assert.deepEqual(baseFolders(parse(README_BASE)), ["References"]);
	assert.deepEqual(baseFolders({ filters: { or: ['file.inFolder("A")', "file.inFolder('B/C')"] } }), ["A", "B/C"]);
	assert.deepEqual(baseFolders({}), []);
});

test("fields match exact names first, then synonyms, each name used once", () => {
	const m = matchProperties(["Citation Key", "Title", "author", "date", "source", "url", "DOI", "state", "itemType"]);
	assert.equal(m.citekey, "Citation Key");
	assert.equal(m.title, "Title");
	assert.equal(m.authors, "author");
	assert.equal(m.year, "date");
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

test("the starter base is valid YAML that reads back to the same folder and fields", () => {
	const names = matchProperties(["Citation Key", "Title", "author", "date", "state", "itemType", "created"]);
	const yamlText = starterBase("My Library/Refs", names);
	const config = parse(yamlText);
	assert.deepEqual(baseFolders(config), ["My Library/Refs"]);
	const props = basePropertyNames(config);
	for (const k of ["citekey", "authors", "year", "type", "status", "added"] as const) assert.ok(props.includes(names[k]), `${k} -> ${names[k]} in ${props}`);
	const again = matchProperties(props);
	for (const k of ["citekey", "authors", "year", "type", "status", "added"] as const) assert.equal(again[k], names[k]);
});
