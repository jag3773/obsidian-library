# Importing bibliography files

**Stacks: Import bibliography file (CSL-JSON, BibTeX, RIS)** brings records from another reference manager, a database search or a colleague's `.bib` file into your references folder. It works the same way as [the Zotero import](migrating-from-zotero.md) and uses the same matching, preview, report and undo.

## How it works

1. Put the file in your vault and choose it. Stacks works out the format from the file's contents, then from its extension (`.json`, `.bib`, `.ris`, or `.txt` from a database export).
2. Choose what tags mean (`Own = owned: true`, `toread = status: queued`), a status for new notes, and the options below.
3. **Preview** is a dry run. It shows how many records will update notes, how each matched, how many notes will be created, and every problem in the file, one line per record. Nothing is written.
4. **Import** writes the notes, then opens a report note listing everything that needs a look. Click the progress notice to stop after the current note.
5. **Stacks: Undo last import** restores every changed note, renames notes back and moves created notes to the trash.

### Matching, and importing again

Each record is matched to an existing note by, in order:

1. the note's filename equals the record's citekey;
2. the note's `citekey` property equals it;
3. a `zotero://select` link to the record's Zotero item (CSL-JSON written by Zotero carries the item's address as its `id`). The library counts: an item from a group library (`http://zotero.org/groups/123/items/…`) only matches a link to that group (`zotero://select/groups/123/items/…`), never a personal item with the same key, and new notes link to the group;
4. a DOI or ISBN that only that note and that record have;
5. for a record with no citekey or Zotero address, its title together with the key your citekey pattern makes for it (the note's filename or `citekey`, as the first import named it), or with its year and first author;
6. an exact title that only that note and that record have.

That is why importing the same file twice, a newer export of it, or the rest of an import you stopped, updates the notes the first import made instead of adding copies. A record whose title matches a note it couldn't otherwise be matched to is listed as a possible duplicate and not created, unless the note's year or first author differs: then it is another work with the same title (two chapters called "Introduction"), and the record gets its own note. Give the note the record's citekey, DOI or ISBN and import again to update it.

### What gets written

- **Existing notes keep their bodies.** Only properties are added, through your property-name mapping in settings. Values a note already has are kept unless you turn on **The file's values win**, which applies to bibliographic fields only. Status, tags, collections and attachments are filled in when empty and never replaced.
- **New notes** use your note template, with the abstract and any notes from the record (`note`, `annote`, RIS `N1`) under a heading.
- **Citekeys from the file are kept**: CSL `id` (or `citation-key`), the BibTeX entry key, the RIS `ID`. A record without one, or with an id that isn't a citekey (a bare number, or a Zotero address), gets a key from your citekey pattern. When a matched note's filename differs from the file's key, the report lists it; **Rename notes to current citekeys** renames it instead, unless another note already has that name.
- **Identifiers** are normalized: DOIs lose their `https://doi.org/` prefix, and the first valid ISBN is kept.

### Attachments

Stacks never copies or moves files from outside your vault. A BibTeX `file` (or BibDesk `pdf`) field and RIS `L1`, `L2` and `L4` links are looked up in the vault: first as a path relative to the imported file's folder (never leaving the vault), then by filename. Found files are linked in `pdf` and `attachments`; the rest are listed in the report under **Attachments outside the vault**. Move them into the vault and import again to link them.

## Supported constructs

The tables say which fields fill which properties. Everything else with a value is listed in the report under **Fields not imported**, with the records that had it. The reverse mapping, from properties to each format, is in [citation fields](citation-fields.md).

### CSL-JSON

A list of items, a single item, or `{"items": [...]}`, as written by Zotero, Better BibTeX, Pandoc, Quarto, Mendeley and citation.js.

| CSL | Property |
|---|---|
| `citation-key`, else `id` | `citekey` |
| `type` | `type`: `article-journal`, `article-magazine`, `article-newspaper`, `post-weblog` → article; `book` → book; `chapter` → chapter; `paper-conference` → paper; `report`, `thesis`, `webpage`, `software`; `motion_picture` → video; `song` → audio; `speech` → presentation; `graphic`, `map` → image; `entry-encyclopedia`, `entry-dictionary` → reference; others → document |
| `title` | `title` |
| `author` (else `director`, `composer`, `performer`, `interviewer`) | `authors` |
| `editor` | `editors` |
| `translator` | `translators` |
| other people (`illustrator`, `narrator`, `compiler`, `contributor`…) | `contributors` |
| `issued` (`date-parts`, `raw` or `literal`) | `published`, `year` |
| `accessed` | `accessed` |
| `container-title` | `journal` |
| `collection-title` | `series` |
| `publisher`, `publisher-place` | `publisher`, `place` |
| `volume`, `issue`, `page`, `edition` | `volume`, `issue`, `pages`, `edition` |
| `ISBN`, `ISSN`, `DOI`, `URL` | `isbn`, `issn`, `doi`, `url` |
| `language`, `abstract` | `language`, `abstract` |
| `keyword` (comma-separated) | `tags` |
| `note` | notes in a new note's body |

Names: `family`, `given`, `non-dropping-particle` and `dropping-particle` (the particle), `suffix`, or `literal` for an organization.

### BibTeX and BibLaTeX

| Field | Property |
|---|---|
| entry key | `citekey` |
| entry type | `type`: `@article` → article; `@book`, `@mvbook`, `@collection`, `@proceedings`, `@reference` → book; `@inbook`, `@incollection` → chapter; `@inproceedings`, `@conference` → paper; `@report`, `@techreport` → report; `@thesis`, `@phdthesis`, `@mastersthesis` → thesis; `@online`, `@electronic`, `@www` → webpage; `@software`; `@video`, `@movie` → video; `@audio`, `@music` → audio; `@inreference` → reference; `@artwork`, `@image` → image; others → document |
| `title` (+ `subtitle`) | `title` |
| `author`, `editor`, `translator` | `authors`, `editors`, `translators` |
| `date`, else `year` and `month` | `published`, `year` |
| `journaltitle`, `journal`, `booktitle` | `journal` |
| `publisher`, else `institution`, `school`, `organization` | `publisher` |
| `location`, `address` | `place` |
| `volume`, `number` (or `issue`), `pages`, `edition`, `series` | `volume`, `issue`, `pages`, `edition`, `series` |
| `isbn`, `issn`, `doi`, `url` | `isbn`, `issn`, `doi`, `url` |
| `howpublished` holding only a URL; arXiv `eprint` | `url`, when there is none |
| `urldate` | `accessed` |
| `langid`, `language` | `language` |
| `abstract` | `abstract` |
| `keywords` (comma- or semicolon-separated) | `tags` |
| `groups` (JabRef) | `collections` |
| `file` (JabRef, Zotero, Mendeley forms), `pdf` | `pdf`, `attachments` (see above) |
| `note`, `annote`, `annotation` | notes in a new note's body |
| `timestamp`, `creationdate`, `date-added` | `added` |

The parser follows BibTeX's rules:

- Text outside entries is a comment. `@comment` and `@preamble` are skipped; `@string` macros are expanded, the month macros `jan`…`dec` are built in, and values join with `#`. Entries may use `{…}` or `(…)`.
- Values may be `{braced}`, `"quoted"` or bare numbers and macros.
- LaTeX becomes Unicode: accents (`\'e`, `{\"o}`, `\c{c}`, `\v{s}`, `\H{o}`, `\'{\i}`…), letters (`\ss`, `\o`, `\ae`, `\l`, `\aa`…), escaped characters (`\&`, `\%`, `\$`, `\_`), dashes (`--`, `---`), quotes (` `` `` and `''`), `~` as a space. Formatting commands (`\emph`, `\textbf`, `\url`…) keep their text. Braces that protect capitals are removed. `url`, `doi` and `file` are taken as written.
- Names split on `and` outside braces, in BibTeX's three forms: `First von Last`, `von Last, First`, and `von Last, Jr, First`. A name in braces (`{World Health Organization}`) is kept whole, a single word is kept whole, and `others` is dropped.

### RIS

Tagged lines from EndNote, Mendeley, Zotero and database exports: `TY  - ` starts a record and `ER  - ` ends it. Repeated tags (`AU`, `KW`, `L1`…) are all read, a line without a tag continues the previous value, and one space either side of the hyphen is accepted.

| Tag | Property |
|---|---|
| `ID` | `citekey` (a bare number is a record number, not a key) |
| `TY` | `type`: `JOUR`, `MGZN`, `NEWS`, `BLOG` → article; `BOOK`, `EBOOK`, `EDBOOK` → book; `CHAP` → chapter; `CONF`, `CPAPER` → paper; `RPRT` → report; `THES` → thesis; `ELEC`, `WEB` → webpage; `COMP` → software; `VIDEO`, `MPCT` → video; `SOUND`, `MUSIC` → audio; `ENCYC`, `DICT` → reference; `ART`, `MAP` → image; `SLIDE` → presentation; others → document |
| `TI`, `T1` | `title` |
| `AU`, `A1` | `authors` |
| `A2`, `ED` | `editors` |
| `A3` | `contributors` |
| `A4` | `translators` |
| `T2`, `JF`, `JO`, `BT`, `JA`, `J2` | `journal` |
| `T3` | `series` |
| `DA`, `PY`, `Y1` (`2021/05/04/`) | `published`, `year` |
| `Y2` | `accessed` |
| `PB`, `CY` | `publisher`, `place` |
| `VL`, `IS`, `SP`–`EP`, `ET` | `volume`, `issue`, `pages`, `edition` |
| `SN` | `isbn` or `issn`, by which it is |
| `DO`, `UR` | `doi`, `url` |
| `LA`, `AB` (or `N2`) | `language`, `abstract` |
| `KW` | `tags` |
| `L1`, `L4`, and `L2` when it isn't a web address | `pdf`, `attachments` (see above) |
| `N1` | notes in a new note's body |

Names are read as `Last, First` (or `Last, First, Suffix`); a name without a comma is split by [the usual rules](citation-fields.md#names), and an organization's name is kept whole.

## Problems the report lists

Each line names the record by its key, or by its position or line in the file:

- **Malformed records**, which are skipped: a BibTeX entry with an unclosed brace or quote or no closing brace (the parser resumes at the next line starting with `@`), a field it can't read, a CSL item that isn't an object, a RIS record without `ER` (kept, ending where the next starts), lines outside any record.
- **Duplicate keys** in the same file: the first record is imported, later ones are skipped.
- **Records imported with a guess**: no key, an id that isn't a citekey, an unknown type (imported as a document), a date, DOI, ISBN or ISSN that can't be read, an undefined BibTeX macro (kept as text).
- **Fields not imported**, with how many records had each and which ones.

Invalid JSON, or a file that isn't any of the three formats, stops the preview with a message. A Better BibTeX JSON export is recognized, and the message points you to **Import from Zotero**, which also reads its collections.

## Not supported yet

- Importing several files in one run: import them one after another. Each run has its own report, and **Undo last import** undoes the most recent.
- BibLaTeX `crossref` and `xdata` inheritance: a child entry gets only its own fields.
- `@string` macros defined after their use, and BibTeX's `{\relax ...}` name tricks.
- RIS `C1`–`C8` custom fields, and EndNote XML.
