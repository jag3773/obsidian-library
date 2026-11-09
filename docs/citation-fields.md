# Citation fields

Stacks keeps a reference's metadata in flat note properties, so Bases can sort, filter and group on them. This page lists each field, what it holds, and how it becomes a citation record when you export a bibliography.

Every field goes through the property-name mapping in settings (**Library base** and the field dropdowns), so your vault can call `volume` `vol`, or `journal` `publicationTitle`. A field is written only when the source has a value: a book never carries empty `volume` or `issue` keys. Lookups fill empty properties only and never overwrite a value you typed.

## Fields

| Field | Holds | CSL-JSON | BibLaTeX |
|---|---|---|---|
| `citekey` | The record's key; also the note's filename | `id` | entry key |
| `type` | `book`, `chapter`, `article`, `paper`, `report`, `thesis`, `document`, `reference`, `webpage`, `video`, `audio`, `software`, `presentation`, `image` | `type` (see below) | entry type (see below) |
| `title` | Full title, with subtitle | `title` | `title` |
| `authors` | Primary creators: authors, a film's director, software's programmer | `author` | `author` |
| `editors` | Editors | `editor` | `editor` |
| `translators` | Translators | `translator` | `translator` |
| `contributors` | Anyone else credited (narrators, illustrators) | `contributor` | – |
| `year` | Four-digit year, a number for sorting and grouping | `issued`, when `published` is empty | `date` |
| `published` | Full publication date: `2021-05-04`, `2021-05` or `2021` | `issued` | `date` |
| `publisher` | Publisher, or a thesis's or report's institution | `publisher` | `publisher` (`institution`, `school`) |
| `place` | Place of publication | `publisher-place` | `location` |
| `journal` | The container: a journal, a chapter's book, a web page's site, a conference's proceedings | `container-title` | `journaltitle`, `booktitle` |
| `volume`, `issue`, `pages` | As printed: `89`, `1/2`, `62-77` | `volume`, `issue`, `page` | `volume`, `number`, `pages` |
| `edition`, `series` | Edition and series | `edition`, `collection-title` | `edition`, `series` |
| `isbn`, `issn`, `doi`, `url` | Identifiers | `ISBN`, `ISSN`, `DOI`, `URL` | `isbn`, `issn`, `doi`, `url` |
| `accessed` | The date a web source was read, set when it's captured from a URL | `accessed` | `urldate` |
| `language` | Language code or name | `language` | `langid` |
| `abstract` | Abstract or description | `abstract` | `abstract` |
| `collections` | Topic notes this reference belongs to, as links | – | – |
| `status`, `pdf`, `attachments`, `added`, `zotero`, `highlights`, `last_highlighted` | Your workflow: reading status, files, date added, the Zotero item it came from, annotation counts | – | – |

Other properties on the note stay where they are and aren't exported.

## Names

People fields hold names as you'd read them, as links when **Authors as links** is on, so they connect to people notes: `authors: ["[[Jane Doe]]"]`.

For citations, each name is split into family and given names by rule: the last word is the family name, with particles such as "van" or "de la" and suffixes such as "Jr." handled. When a name wouldn't split that way, the property also carries its sort form, in BibTeX's own conventions:

| Written | Means |
|---|---|
| `[[Gabriel García Márquez\|García Márquez, Gabriel]]` | A link to the person, with the split as its alias |
| `García Márquez, Gabriel` | The same, as plain text |
| `{Mission Network News}` or `[[Mission Network News\|{Mission Network News}]]` | An organization or other name used as is |

Stacks writes these forms itself when a source (Crossref, a Zotero import) says how a name splits. A single word, or a name containing a word such as University, Press, Foundation or Organization, is treated as an organization's.

## Types

| `type` | CSL type | BibLaTeX type |
|---|---|---|
| `book` | `book` | `book` |
| `chapter` | `chapter` | `incollection` |
| `article` with a volume, issue, ISSN or DOI | `article-journal` | `article` |
| `article` otherwise (news, magazine, blog) | `article-magazine` | `article` |
| `paper` | `paper-conference` | `inproceedings` |
| `report` | `report` | `report` |
| `thesis` | `thesis` | `thesis` |
| `webpage` | `webpage` | `online` |
| `software` | `software` | `software` |
| `video` | `motion_picture` | `video` |
| `audio` | `song` | `audio` |
| `presentation` | `speech` | `misc` |
| `reference` | `entry-encyclopedia` | `inreference` |
| `image` | `graphic` | `artwork` |
| anything else | `document` | `misc` |

## What each type needs

Exports report records that lack these, so you can fill them in:

| Type | Needs, besides a citekey and title |
|---|---|
| Book | an author or editor, a date, a publisher |
| Chapter | an author, the book (`journal`), a date, a publisher |
| Journal article | an author, the journal, a date |
| News or magazine article | the publication, a date |
| Conference paper | an author, the proceedings, a date |
| Thesis | an author, the institution (`publisher`), a date |
| Report | an author or editor, a date |
| Web page, software | a URL |

## What formats can't hold

- **BibTeX** (as opposed to BibLaTeX) has no fields for translators, the access date or language, and keeps only the year and month of a date. Stacks writes them as BibLaTeX fields, which BibTeX styles ignore.
- **Neither format** keeps `contributors`, `collections`, `status` or your own properties.
