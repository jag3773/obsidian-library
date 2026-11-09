// #17: importing CSL-JSON, BibTeX/BibLaTeX and RIS files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { App, TFile } from "obsidian";
import { Library } from "../src/library";
import { withDefaults } from "../src/settings";
import { DEFAULT_IMPORT_CHOICES, ImportChoices } from "../src/importers/plan";
import { parseCslJson, cslDateToIso } from "../src/importers/csljson";
import { bibFiles, bibName, bibNames, decodeLatex, parseBibtex } from "../src/importers/bibtex";
import { parseRis, risDate } from "../src/importers/ris";
import { detectFormat } from "../src/importers/detect";
import { splitKeywords } from "../src/importers/record";
import { FileImporter } from "../src/fileImport";
import { importReportMarkdown } from "../src/zoteroImport";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function flush(rounds = 30) {
	for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

// CSL-JSON -----------------------------------------------------------------------------------

const CSL = JSON.stringify([
	{
		id: "doe2020",
		type: "article-journal",
		title: "A Study of Things",
		author: [{ family: "Doe", given: "Jane" }, { family: "Beethoven", given: "Ludwig", "non-dropping-particle": "van" }, { literal: "World Health Organization" }],
		editor: [{ family: "Roe", given: "Rick" }],
		issued: { "date-parts": [[2020, 5, 4]] },
		accessed: { "date-parts": [["2024", "1", "2"]] },
		"container-title": "Journal of Things",
		volume: 12,
		issue: "3",
		page: "1-10",
		DOI: "https://doi.org/10.1000/ABC",
		ISSN: "1234-5678",
		keyword: "climate, policy",
		note: "Read twice.",
		medium: "Print",
	},
	{ id: "http://zotero.org/users/1/items/ABCD2345", type: "book", title: "A Book", author: [{ family: "Poe", given: "Edgar" }], issued: { raw: "March 1999" }, ISBN: "978-0-14-312837-3", publisher: "Example Press", "publisher-place": "Chicago" },
	{ id: "odd", type: "hologram", title: "Odd Type", issued: { "date-parts": [["nope"]] } },
	"not an item",
	{ id: "doe2020", type: "book", title: "Same id again" },
	{ type: "webpage", URL: "https://example.com", title: "No Id" },
]);

test("CSL-JSON: fields, names, dates, identifiers and keys", () => {
	const { records, diagnostics } = parseCslJson(CSL);
	assert.equal(records.length, 4, "the non-object and the second doe2020 are skipped");
	const [a, b, odd, noId] = records;
	assert.equal(a.citekey, "doe2020");
	assert.equal(a.data.type, "article");
	assert.deepEqual(a.data.authors, ["Jane Doe", "Ludwig van Beethoven", "World Health Organization"]);
	assert.deepEqual(a.data.names?.authors?.[1], { family: "Beethoven", given: "Ludwig", particle: "van" });
	assert.deepEqual(a.data.familyNames, ["Doe", "Beethoven", "World Health Organization"]);
	assert.deepEqual(a.data.editors, ["Rick Roe"]);
	assert.equal(a.data.date, "2020-05-04");
	assert.equal(a.data.year, 2020);
	assert.equal(a.data.accessed, "2024-01-02");
	assert.equal(a.data.journal, "Journal of Things");
	assert.equal(a.data.volume, "12");
	assert.equal(a.data.doi, "10.1000/ABC");
	assert.deepEqual(a.tags.map((t) => t.tag), ["climate", "policy"]);
	assert.deepEqual(a.notes, ["Read twice."]);
	assert.deepEqual(a.unmapped, ["medium"]);
	assert.equal(b.citekey, undefined, "a Zotero URI isn't a citekey");
	assert.equal(b.zoteroKey, "ABCD2345", "but it links to the Zotero item");
	assert.equal(b.data.date, "1999-03");
	assert.equal(b.data.isbn, "9780143128373");
	assert.equal(b.data.place, "Chicago");
	assert.equal(odd.data.type, "document");
	assert.equal(noId.citekey, undefined);
	const problems = diagnostics.map((d) => `${d.record}: ${d.problem}`);
	assert.ok(problems.includes('odd: type "hologram" imported as a document'));
	assert.ok(problems.includes("odd: issued date can't be read"));
	assert.ok(problems.includes("record 4: not an object; skipped"));
	assert.ok(problems.some((p) => /^doe2020: id used by an earlier record/.test(p)));
	assert.ok(problems.includes("record 6: no id; a citekey is made from the pattern in settings"));
	assert.ok(problems.some((p) => p.startsWith("record 2: id \"http://zotero.org")));
});

test("CSL-JSON: other shapes and broken files", () => {
	assert.equal(parseCslJson(JSON.stringify({ id: "one", type: "book", title: "T" })).records.length, 1, "a single item");
	assert.equal(parseCslJson(JSON.stringify({ items: [{ id: "x", type: "book", title: "T" }] })).records.length, 1, "{items: [...]}");
	assert.equal(parseCslJson("\uFEFF[]").records.length, 0, "a byte-order mark and an empty list");
	assert.throws(() => parseCslJson("[{"), /Not valid JSON/);
	assert.throws(() => parseCslJson("42"), /Not CSL-JSON/);
	assert.equal(cslDateToIso({ literal: "Spring 2003" }), "2003");
	assert.equal(cslDateToIso("2021-05"), "2021-05");
	const film = parseCslJson(JSON.stringify([{ id: "f", type: "motion_picture", title: "F", director: [{ family: "Lee", given: "Ang" }], "citation-key": "lee2000" }])).records[0];
	assert.equal(film.citekey, "lee2000", "citation-key wins over id");
	assert.deepEqual(film.data.authors, ["Ang Lee"], "a film's director is its primary creator");
	assert.equal(film.data.type, "video");
});

// BibTeX -------------------------------------------------------------------------------------

test("LaTeX: accents, symbols, commands and braces", () => {
	assert.equal(decodeLatex(String.raw`Caf\'e cr\`eme, {\"o}, \"{u}ber, \c{c}a, \v{S}koda, Mont\'{\i}a, \'\i`), "Café crème, ö, über, ça, Škoda, Montía, í");
	assert.equal(decodeLatex(String.raw`Stra\ss{}e and \o{}re, {\AA}ngstr\"om, \l\'od\'z`), "Straße and øre, Ångström, łódź");
	assert.equal(decodeLatex(String.raw`The {NASA} \emph{Mission} to \textbf{Mars}`), "The NASA Mission to Mars");
	assert.equal(decodeLatex("pp.~1--10 --- ``quoted'' \\& 50\\% \\$5"), "pp. 1–10 — “quoted” & 50% $5");
	assert.equal(decodeLatex("$E=mc^2$ and \\unknown{kept} \\relax done"), "E=mc^2 and kept done");
	assert.equal(decodeLatex("Erd\\H{o}s and \\u{g}"), "Erdős and ğ");
	assert.equal(decodeLatex(String.raw`\href{http://x}{the link}`), "the link");
});

test("BibTeX names: First von Last, von Last, First, Jr, braces and others", () => {
	assert.deepEqual(bibName("Jane Doe"), { given: "Jane", family: "Doe" });
	assert.deepEqual(bibName("Doe, Jane"), { given: "Jane", family: "Doe" });
	assert.deepEqual(bibName("Ludwig van Beethoven"), { given: "Ludwig", particle: "van", family: "Beethoven" });
	assert.deepEqual(bibName("van Beethoven, Ludwig"), { given: "Ludwig", particle: "van", family: "Beethoven" });
	assert.deepEqual(bibName("Jean de La Fontaine"), { given: "Jean", particle: "de", family: "La Fontaine" });
	assert.deepEqual(bibName("King, Jr., Martin Luther"), { given: "Martin Luther", family: "King", suffix: "Jr." });
	assert.deepEqual(bibName("{World Health Organization}"), { literal: "World Health Organization" });
	assert.deepEqual(bibName("Garc{\\'i}a M{\\'a}rquez, Gabriel"), { given: "Gabriel", family: "García Márquez" });
	assert.deepEqual(bibName("{\\'E}mile Zola"), { given: "Émile", family: "Zola" });
	assert.deepEqual(bibName("Plato"), { literal: "Plato" });
	const { names, others } = bibNames("Doe, Jane and {Barnes and Noble} AND Smith, J. and others");
	assert.deepEqual(names, [{ given: "Jane", family: "Doe" }, { literal: "Barnes and Noble" }, { given: "J.", family: "Smith" }]);
	assert.equal(others, true);
});

const BIB = String.raw`
% A comment, and an email: someone@example.com
@comment{jabref-meta: databaseType:biblatex;}
@preamble{"\newcommand{\noop}[1]{}"}
@string{jtp = "Journal of Things"}
@string{ pre = {Proceedings of } }

@article{doe2020,
  author = {Doe, Jane and van Beethoven, Ludwig and {World Health Organization}},
  title = {The {NASA} Study of Caf\'e Culture},
  subtitle = {A Second Look},
  journaltitle = jtp,
  date = {2020-05-04},
  volume = 12, number = {3},
  pages = {1--10},
  doi = {10.1000/abc_def},
  url = {https://example.com/a_b?x=1%20},
  urldate = {2024-01-02},
  keywords = {climate; policy},
  file = {Full Text:papers/doe2020.pdf:PDF;Scan:C\:\\Users\\x\\scan.pdf:PDF},
  langid = {english},
  shorttitle = {NASA Study},
  note = {Read twice.},
}

@inproceedings{roe1999,
  author = "Rick Roe and Mary {de la} Cruz",
  title = "Talk",
  booktitle = pre # "the Meeting",
  year = 1999, month = mar,
  address = {Paris},
  publisher = {ACM},
}

@book{broken2001,
  title = {Unclosed {brace},
  year = {2001}

@book{after2002,
  title = {After the Broken One},
  author = {Poe, Edgar},
  year = {2002},
  isbn = {978-0-14-312837-3},
  howpublished = {\url{https://example.com/book}},
}

@book{doe2020,
  title = {Duplicate key},
}

@thingamajig{odd,
  title = {Odd Type},
  year = {20xx},
  eprint = {2303.08774}, eprinttype = {arxiv},
}

@misc{
  title = {No Key Here},
  year = 2010,
}

@article{macro2003, title = {Uses an undefined} # nomacro, year = 2003}
`;

test("BibTeX: entries, macros, fields and diagnostics", () => {
	const { records, diagnostics } = parseBibtex(BIB);
	assert.deepEqual(
		records.map((r) => r.label),
		["doe2020", "roe1999", "after2002", "odd", "line 57", "macro2003"]
	);
	const [doe, roe, after, odd, noKey, macro] = records;
	assert.equal(doe.data.type, "article");
	assert.equal(doe.data.title, "The NASA Study of Café Culture: A Second Look");
	assert.deepEqual(doe.data.authors, ["Jane Doe", "Ludwig van Beethoven", "World Health Organization"]);
	assert.deepEqual(doe.data.names?.authors?.[2], { literal: "World Health Organization" });
	assert.equal(doe.data.journal, "Journal of Things");
	assert.equal(doe.data.date, "2020-05-04");
	assert.equal(doe.data.issue, "3");
	assert.equal(doe.data.pages, "1-10");
	assert.equal(doe.data.doi, "10.1000/abc_def", "verbatim: underscores kept");
	assert.equal(doe.data.url, "https://example.com/a_b?x=1%20");
	assert.equal(doe.data.accessed, "2024-01-02");
	assert.equal(doe.data.language, "english");
	assert.deepEqual(doe.tags.map((t) => t.tag), ["climate", "policy"]);
	assert.deepEqual(doe.attachments, ["papers/doe2020.pdf", "C:\\Users\\x\\scan.pdf"]);
	assert.deepEqual(doe.notes, ["Read twice."]);
	assert.deepEqual(doe.unmapped, ["shorttitle"]);
	assert.equal(doe.sourceType, "@article");

	assert.equal(roe.data.type, "paper");
	assert.deepEqual(roe.data.authors, ["Rick Roe", "Mary de la Cruz"]);
	assert.equal(roe.data.journal, "Proceedings of the Meeting", "macros joined with #");
	assert.equal(roe.data.date, "1999-03", "month macro");
	assert.equal(roe.data.place, "Paris");

	assert.equal(after.data.isbn, "9780143128373");
	assert.equal(after.data.url, "https://example.com/book", "a URL in howpublished");
	assert.equal(odd.data.type, "document");
	assert.equal(odd.data.url, "https://arxiv.org/abs/2303.08774");
	assert.equal(noKey.citekey, undefined);
	assert.equal(noKey.data.title, "No Key Here");
	assert.equal(macro.data.title, "Uses an undefinednomacro");

	const problems = diagnostics.map((d) => `${d.record}: ${d.problem}`);
	assert.ok(problems.some((p) => /^@book on line 35: a brace opened on line 36 isn't closed; skipped$/.test(p)), problems.join("\n"));
	assert.ok(problems.some((p) => /^doe2020: key used by an earlier entry/.test(p)));
	assert.ok(problems.includes("odd: entry type @thingamajig imported as a document"));
	assert.ok(problems.includes('odd: year "20xx" can\'t be read'));
	assert.ok(problems.includes("line 57: no citekey; one is made from the pattern in settings"));
	assert.ok(problems.includes('macro2003: undefined macro "nomacro" in title, kept as text'));
	assert.ok(!problems.some((p) => p.includes("example.com")), "an @ in a comment isn't an entry");
});

test("BibTeX: an entry left open at the end of the file, and parenthesized entries", () => {
	const r = parseBibtex("@article(paren2000, title = {Parens}, year = 2000)\n@book{open,\n  title = {Never closed}\n");
	assert.deepEqual(r.records.map((x) => x.citekey), ["paren2000"]);
	assert.match(r.diagnostics[0].problem, /isn't closed; skipped/);
	assert.deepEqual(parseBibtex("").records, []);
	assert.deepEqual(parseBibtex("Just text, no entries.").records, []);
});

test("BibTeX file fields: JabRef, Mendeley and bare paths", () => {
	assert.deepEqual(bibFiles("/Users/x/Zotero/storage/ABCD1234/paper.pdf"), ["/Users/x/Zotero/storage/ABCD1234/paper.pdf"]);
	assert.deepEqual(bibFiles(":C\\:/Users/x/paper.pdf:pdf"), ["C:/Users/x/paper.pdf"]);
	assert.deepEqual(bibFiles("a.pdf;b.pdf"), ["a.pdf", "b.pdf"]);
	assert.deepEqual(bibFiles("C:\\papers\\a.pdf"), ["C:\\papers\\a.pdf"]);
});

// RIS ----------------------------------------------------------------------------------------

const RIS = [
	"TY  - JOUR",
	"ID  - doe2020",
	"AU  - Doe, Jane",
	"AU  - van Beethoven, Ludwig",
	"A1  - World Health Organization",
	"TI  - A Study of",
	"  Many Things",
	"T2  - Journal of Things",
	"PY  - 2020",
	"DA  - 2020/05/04/",
	"VL  - 12",
	"IS  - 3",
	"SP  - 1",
	"EP  - 10",
	"SN  - 1234-5678",
	"DO  - 10.1000/abc",
	"UR  - https://example.com/a",
	"L1  - file:///Users/x/papers/doe.pdf",
	"KW  - climate",
	"KW  - policy; law",
	"AB  - First line.",
	"Second line.",
	"N1  - A note.",
	"M3  - Print",
	"ER  - ",
	"",
	"TY  - BOOK",
	"ID  - 42",
	"AU  - Poe, Edgar",
	"TI  - A Book",
	"PY  - 1999///",
	"SN  - 978-0-14-312837-3",
	"PB  - Example Press",
	"CY  - Chicago",
	"A2  - Roe, Rick",
	"TY  - WIDGET",
	"TI  - Missing End",
	"PY  - sometime",
	"SN  - not-a-number",
	"ER  -",
	"stray text",
].join("\r\n");

test("RIS: tags, repeats, continuations and diagnostics", () => {
	const { records, diagnostics } = parseRis(RIS);
	assert.equal(records.length, 3);
	const [doe, book, odd] = records;
	assert.equal(doe.citekey, "doe2020");
	assert.equal(doe.data.type, "article");
	assert.deepEqual(doe.data.authors, ["Jane Doe", "Ludwig van Beethoven", "World Health Organization"]);
	assert.equal(doe.data.title, "A Study of Many Things", "a continuation line");
	assert.equal(doe.data.journal, "Journal of Things");
	assert.equal(doe.data.date, "2020-05-04", "DA's full date beats PY's year");
	assert.equal(doe.data.pages, "1-10");
	assert.equal(doe.data.issn, "1234-5678");
	assert.equal(doe.data.doi, "10.1000/abc");
	assert.deepEqual(doe.tags.map((t) => t.tag), ["climate", "policy", "law"]);
	assert.deepEqual(doe.attachments, ["file:///Users/x/papers/doe.pdf"]);
	assert.equal(doe.data.abstract, "First line.\nSecond line.");
	assert.deepEqual(doe.notes, ["A note."]);
	assert.deepEqual(doe.unmapped, ["M3"]);

	assert.equal(book.citekey, undefined, "a numeric ID isn't a citekey");
	assert.equal(book.data.type, "book");
	assert.equal(book.data.date, "1999");
	assert.equal(book.data.isbn, "9780143128373");
	assert.deepEqual(book.data.editors, ["Rick Roe"]);
	assert.equal(book.data.place, "Chicago");
	assert.equal(odd.data.type, "document");

	const problems = diagnostics.map((d) => `${d.record}: ${d.problem}`);
	assert.ok(problems.includes("line 27: the record has no ER line; it ends where the next one starts"));
	assert.ok(problems.some((p) => /ID "42" isn't a citekey/.test(p)));
	assert.ok(problems.some((p) => /type WIDGET imported as a document/.test(p)));
	assert.ok(problems.some((p) => /date "sometime" can't be read/.test(p)));
	assert.ok(problems.some((p) => /SN "not-a-number" isn't an ISBN or ISSN/.test(p)));
	assert.ok(problems.includes("file: 1 line outside any record ignored"));
	assert.equal(risDate("2021/5//"), "2021-05");
	assert.equal(risDate("2021-05-04"), "2021-05-04");
});

test("format detection and keyword lists", () => {
	assert.equal(detectFormat("x.json", "[{}]"), "csl-json");
	assert.equal(detectFormat("x.json", '{"config":{},"items":[{"itemType":"book","key":"ABCD2345"}]}'), "zotero");
	assert.equal(detectFormat("export.txt", "\uFEFFTY  - JOUR\nER  - \n"), "ris");
	assert.equal(detectFormat("refs.txt", "% c\n@article{a, title={T}}"), "bibtex");
	assert.equal(detectFormat("refs.bib", ""), "bibtex");
	assert.equal(detectFormat("notes.md", "hello"), undefined);
	assert.deepEqual(splitKeywords("a, b , a"), ["a", "b"]);
	assert.deepEqual(splitKeywords("one, two; three"), ["one, two", "three"]);
});

// The import, end to end ---------------------------------------------------------------------

function vault(files: Record<string, string>) {
	const app = new App();
	for (const [p, c] of Object.entries(files)) app.vault.addFile(p, c);
	const settings = withDefaults({});
	const library = new Library(app as any, () => settings);
	const importer = new FileImporter(app as any, library, () => settings, ".obsidian/plugins/stacks/backups");
	return { app, settings, library, importer };
}

const fm = (app: App, path: string) => app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(path) as TFile)?.frontmatter ?? {};

const SMALL_BIB = String.raw`
@article{doe2020,
  author = {Doe, Jane and M{\"u}ller, Hans},
  title = {A Study},
  journal = {Journal of Things},
  year = 2020,
  doi = {10.1000/abc},
  keywords = {Own, climate},
  file = {:papers/doe2020.pdf:PDF;:/Users/x/elsewhere.pdf:PDF},
  shorttitle = {Study},
}
@book{poe1999,
  author = {Poe, Edgar},
  title = {A Book},
  year = 1999,
  isbn = {978-0-14-312837-3},
}
@misc{nokey,
`;

test("a BibTeX import creates notes, links vault attachments, lists outside ones, and reports problems", async () => {
	const { app, importer } = vault({
		"refs/library.bib": SMALL_BIB,
		"refs/papers/doe2020.pdf": "%PDF",
		// An existing note with the book's ISBN but another name: matched, not duplicated.
		"References/My Poe Book.md": "---\nisbn: 978-0143128373\nstatus: reading\n---\n# My Poe Book\n",
	});
	const choices: ImportChoices = { ...DEFAULT_IMPORT_CHOICES, exportPath: "refs/library.bib", tagRules: "Own = owned: true", fallbackStatus: "queued" };
	const { plan, format } = await importer.plan(choices);
	assert.equal(format, "bibtex");
	assert.equal(plan.source, "BibTeX");
	assert.deepEqual(plan.creates.map((c) => c.path), ["References/doe2020.md"]);
	assert.equal(plan.updates[0].note.path, "References/My Poe Book.md");
	assert.equal(plan.updates[0].matchedBy, "identifier");
	assert.deepEqual(plan.report.attachmentsNotInVault, [{ citekey: "doe2020", path: "/Users/x/elsewhere.pdf" }]);
	assert.deepEqual(plan.report.unmappedRecords, { shorttitle: ["doe2020"] });
	assert.equal(plan.report.diagnostics.length, 1);
	assert.match(plan.report.diagnostics[0].problem, /isn't closed/);
	const preview = importReportMarkdown(plan.report, plan, choices);
	assert.match(preview, /# BibTeX import/);
	assert.match(preview, /Dry run: nothing written/);
	assert.match(preview, /## Problems in the file \(1\)/);
	assert.match(preview, /`shorttitle`: 1 record \(`doe2020`\)/);
	assert.doesNotMatch(preview, /Better BibTeX exports/, "no Zotero advice");

	const backup = await importer.apply(plan, choices);
	await flush();
	const doe = fm(app, "References/doe2020.md");
	assert.equal(doe.citekey, "doe2020", "the file's key is kept");
	assert.deepEqual(doe.authors, ["[[Jane Doe]]", "[[Hans Müller]]"]);
	assert.equal(doe.doi, "10.1000/abc");
	assert.equal(doe.owned, true, "tag rules apply");
	assert.deepEqual(doe.tags, ["climate"]);
	assert.equal(doe.status, "queued");
	assert.equal(doe.pdf, "[[doe2020.pdf]]", "a relative path resolved from the .bib file's folder");
	assert.equal(doe.zotero, undefined);
	const poe = fm(app, "References/My Poe Book.md");
	// Without "Rename notes to current citekeys", the filename stays the citekey and the report lists the file's key.
	assert.equal(poe.citekey, "My Poe Book");
	assert.deepEqual(plan.report.keyChanges, [{ note: "References/My Poe Book.md", citekey: "poe1999", renamed: false }]);
	assert.equal(poe.status, "reading", "workflow values are yours");
	assert.equal(poe.title, "A Book");
	const report = await app.vault.read(app.vault.getAbstractFileByPath(backup.reportPath) as TFile);
	assert.match(backup.reportPath, /Bibliography import/);
	assert.match(report, /Stacks never copies files from outside the vault/);
	assert.match(report, /\| · matched by identifier \| 1 \|/);
	assert.equal(app.vault.getAbstractFileByPath("References/elsewhere.pdf"), null, "nothing copied");
});

test("importing the same file again updates the same notes and creates nothing", async () => {
	const { app, importer } = vault({ "library.bib": SMALL_BIB, "papers/doe2020.pdf": "%PDF" });
	const choices: ImportChoices = { ...DEFAULT_IMPORT_CHOICES, exportPath: "library.bib" };
	await importer.apply((await importer.plan(choices)).plan, choices);
	await flush();
	const snapshot = new Map<string, string>();
	for (const f of app.vault.getMarkdownFiles()) if (f.path.startsWith("References/")) snapshot.set(f.path, await app.vault.read(f));
	assert.equal(snapshot.size, 2);
	const again = (await importer.plan(choices)).plan;
	assert.equal(again.creates.length, 0);
	assert.equal(again.updates.length, 2);
	assert.equal(again.report.matched.filename, 2);
	await importer.apply(again, choices);
	await flush();
	for (const [p, text] of snapshot) assert.equal(await app.vault.read(app.vault.getAbstractFileByPath(p) as TFile), text, p);
	assert.equal(app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("References/")).length, 2);
});

test("the same works in CSL-JSON and RIS, and their notes match each other's", async () => {
	const csl = JSON.stringify([{ id: "doe2020", type: "article-journal", title: "A Study", author: [{ family: "Doe", given: "Jane" }], DOI: "10.1000/abc", issued: { "date-parts": [[2020]] } }]);
	const ris = "TY  - JOUR\nAU  - Doe, Jane\nTI  - A Study\nDO  - 10.1000/ABC\nPY  - 2020\nVL  - 7\nER  - \n";
	const { app, importer } = vault({ "a.json": csl, "b.ris": ris });
	const first: ImportChoices = { ...DEFAULT_IMPORT_CHOICES, exportPath: "a.json" };
	await importer.apply((await importer.plan(first)).plan, first);
	await flush();
	const second: ImportChoices = { ...DEFAULT_IMPORT_CHOICES, exportPath: "b.ris" };
	const { plan } = await importer.plan(second);
	assert.equal(plan.source, "RIS");
	assert.equal(plan.creates.length, 0, "the RIS record has no ID, but its DOI finds the note");
	assert.equal(plan.updates[0].matchedBy, "identifier");
	await importer.apply(plan, second);
	await flush();
	assert.equal(fm(app, "References/doe2020.md").volume, "7", "empty properties filled from the second file");
});

test("a record without a key gets one from the citekey pattern", async () => {
	const { importer } = vault({ "x.ris": "TY  - BOOK\nAU  - Poe, Edgar\nTI  - The Raven Book\nPY  - 1845\nER  - \n" });
	const { plan } = await importer.plan({ ...DEFAULT_IMPORT_CHOICES, exportPath: "x.ris" });
	assert.equal(plan.creates[0].extras.citekey, "poeRavenBook1845");
	assert.equal(plan.creates[0].path, "References/poeRavenBook1845.md");
});

test("a stopped import keeps a backup and a report, can be undone, and a re-run finishes it", async () => {
	const bib = ["a", "b", "c"].map((k) => `@book{${k}2000, title = {Book ${k.toUpperCase()}}, year = 2000}`).join("\n");
	const { app, importer } = vault({ "l.bib": bib });
	const choices: ImportChoices = { ...DEFAULT_IMPORT_CHOICES, exportPath: "l.bib" };
	let done = 0;
	const backup = await importer.apply((await importer.plan(choices)).plan, choices, (d) => (done = d), () => done >= 1);
	await flush();
	assert.deepEqual(backup.stopped, { done: 1, total: 3 });
	assert.deepEqual(backup.created, ["References/a2000.md"]);
	assert.match(await app.vault.read(app.vault.getAbstractFileByPath(backup.reportPath) as TFile), /Stopped after 1 of 3 notes/);
	const rerun = (await importer.plan(choices)).plan;
	assert.deepEqual([rerun.updates.length, rerun.creates.length], [1, 2]);
	const r = await importer.undo(importer.lastBackup);
	assert.equal(r.trashed, 1);
	assert.equal(app.vault.getAbstractFileByPath("References/a2000.md"), null);
});

test("files that aren't a bibliography, or are a Zotero export, are refused with a reason", async () => {
	const { importer } = vault({ "n.md": "hello", "z.json": '{"items":[{"itemType":"book","key":"ABCD2345"}]}', "bad.json": "[{" });
	await assert.rejects(importer.plan({ ...DEFAULT_IMPORT_CHOICES, exportPath: "n.md" }), /isn't CSL-JSON, BibTeX or RIS/);
	await assert.rejects(importer.plan({ ...DEFAULT_IMPORT_CHOICES, exportPath: "z.json" }), /Use Import from Zotero/);
	await assert.rejects(importer.plan({ ...DEFAULT_IMPORT_CHOICES, exportPath: "bad.json" }), /bad\.json: Not valid JSON/);
	await assert.rejects(importer.plan({ ...DEFAULT_IMPORT_CHOICES, exportPath: "missing.bib" }), /No file at missing\.bib/);
});

test("attachment paths never escape the vault", async () => {
	const { app, importer } = vault({ "sub/l.bib": "@book{a2000, title = {A}, file = {../../outside.pdf}}", "outside.pdf": "%PDF" });
	const { plan } = await importer.plan({ ...DEFAULT_IMPORT_CHOICES, exportPath: "sub/l.bib" });
	// "../../outside.pdf" leaves the vault as a path; only its filename is looked up.
	assert.deepEqual(plan.creates[0].extras.attachments, ["outside.pdf"]);
	assert.ok(app.vault.getAbstractFileByPath("outside.pdf"));
});
