# Stacks: Obsidian plugin specification

A reference manager that lives entirely in an Obsidian vault. One Markdown note per source, metadata in properties, PDFs next to them, and Obsidian Bases as the library UI. MIT licensed.

Status: stages 1 and 2 implemented in `src/`. Stage 3 is specified here and not yet built. User documentation for stage 2: [docs/annotations.md](docs/annotations.md).

## 1. Goals

1. Replace the day-to-day jobs of Zotero for people who already think in Obsidian: capture metadata, assign a stable citekey, file the PDF, track reading status, pull highlights into the note, and export citations.
2. Store everything as plain Markdown and properties so the library works without the plugin installed. The plugin automates; it never owns the data.
3. Fit an existing vault. Every folder, property name, status value, citekey pattern and template is a setting. Nothing about one person's setup is hard coded.
4. Work on mobile where Obsidian allows it. Desktop-only features (file-system access outside the vault, external commands) degrade quietly on mobile.

## 2. Non-goals

- Group libraries, sync between people, or a second metadata database. The vault is the database.
- A built-in PDF reader. Obsidian's PDF viewer and the PDF++ plugin already exist.
- OCR. It needs platform APIs a plugin can't reach well. The spec leaves a hook for an external command.
- Replacing Obsidian Web Clipper. The plugin processes what Web Clipper saves.

## 3. Data model

One note per reference in the references folder, named by the filename format (default: the citekey). The plugin reads and writes these logical properties. Each logical name maps to a real property name in settings, so a vault that uses `author` instead of `authors` keeps working.

| Logical property | Default name | Type | Written by |
|---|---|---|---|
| citekey | `citekey` | text | stage 1 |
| type | `type` | text: book, chapter, article, webpage, video, audio, document, report, thesis, presentation, paper, software, image, reference | stage 1 |
| title | `title` | text | stage 1 |
| authors | `authors` | list (links or plain text, setting) | stage 1 |
| year | `year` | number | stage 1 |
| publisher | `publisher` | text | stage 1 |
| journal | `journal` | text (journal, site or container) | stage 1 |
| isbn | `isbn` | text | stage 1 |
| doi | `doi` | text | stage 1 |
| url | `url` | text | stage 1 |
| collections | `collections` | list of links | user |
| tags | `tags` | list | user |
| status | `status` | one of the configured statuses | stage 1 sets default, stage 2 transitions |
| owned | `owned` | checkbox | user |
| pdf | `pdf` | link to the primary PDF | stage 1 |
| attachments | `attachments` | list of links | stage 1 |
| highlights | `highlights` | number | stage 2 |
| lastHighlighted | `last_highlighted` | date | stage 2 |
| added | `added` | date | stage 1 |

Rules:

- The plugin only fills empty properties when it enriches an existing note. It never overwrites a value you typed.
- The note body belongs to the user, except the annotations section (stage 2), which the plugin regenerates between markers.
- Statuses are an ordered list in settings. Three of them have roles: the default status for new items, the status that sends a PDF to the tablet, and the status set when highlights come back. Defaults: `queued, reading, reviewing, processed, shelved`.

## 4. Settings

All paths are vault-relative unless marked absolute. "Example (ekfocus)" shows the author's own configuration as a worked example.

### 4.1 General (stage 1)

| Setting | Default | Example (ekfocus) | Purpose |
|---|---|---|---|
| References folder | `References` | `resources/zotero` | Where reference notes live |
| Attachments folder | `References/attachments` | `archive/zotero` | Where PDFs and other files are filed |
| Inbox folder | `Inbox` | `resources/inbox` | Drop zone for Web Clipper notes and PDFs |
| Filename format | `{{citekey}}` | `{{citekey}}` | Note filename. Tokens: `{{citekey}}`, `{{title}}`, `{{year}}`, `{{author}}` |
| Attachment filename format | `{{citekey}}` | `{{citekey}}` | PDF filename (extension kept) |
| Citekey pattern | `auth.lower + shorttitle(3, 3) + year` | same | Better BibTeX-compatible subset, see 4.4 |
| Note template | empty (built-in) | empty | Optional template file for the note body, see 4.5 |
| Authors as links | on | on | Write `[[Name]]` so people notes connect |
| Statuses | `queued, reading, reviewing, processed, shelved` | same | Ordered list |
| Default status for new items | `queued` | `queued` | Set on add-by-identifier |
| Default status for web clips | `shelved` | `shelved` | Set when processing inbox notes |
| Process inbox automatically | on | on | React to new files in the inbox folder |
| Complete notes on property edit | on | on | A note in the references folder with an ISBN, DOI or URL and no citekey gets filled in and renamed |
| URL properties in clipped notes | `url, source` | `url, source` | Where to look for the URL in Web Clipper output |
| Crossref contact email | empty | user's choice | Sent as `mailto` for Crossref's polite pool; never filled by default |
| Library base | empty | `Library.base` | The base that shows the library. Its `file.inFolder()` sets the references folder; its properties (and those on notes in that folder) are matched to the fields below |
| Fields | logical names | matched from the base | Map of logical → real property names (section 3), chosen from the base's properties in dropdowns |

### 4.2 Reading round trip (stage 2)

| Setting | Default | Example (ekfocus) | Purpose |
|---|---|---|---|
| Tablet folder (absolute, desktop only) | empty (feature off) | the MoonReader+ Dropbox folder | Folder your reading app syncs with |
| Send to tablet on status | `reading` | `reading` | Copy the PDF to the tablet folder when status changes to this |
| Status when highlights return | `reviewing` | `reviewing` | Set when a modified PDF comes back |
| Bring back PDFs Stacks didn't send | off | on | Also import same-named, newer PDFs found in the tablet folder |
| Status after extraction | empty (unchanged) | `processed` | Set after annotations are written, only moving forward in the status list. Off by default so the round trip's `reviewing` step isn't skipped |
| Annotations heading | `## Annotations` | `## Annotations` | Heading the generated block goes under; the plugin owns only what is between its HTML comment markers |
| Highlight color map | yellow → quote, red → important, green → tip ("Follow up"), blue → example ("Image"), default → quote, note → note | same colors as the author's Zotero Integration template | Color → callout type, with a label |
| Pre-extraction command (desktop only) | empty | `python3 resources/scripts/expand_highlights.py {in} {out}` | Optional external step run on returned PDFs and by the extract command, from the vault folder |
| Extract on PDF save | off | on | Re-extract when the PDF in the attachments folder changes (e.g. edited in PDF++) |

### 4.3 Citations and maintenance (stage 3)

| Setting | Default | Purpose |
|---|---|---|
| Bibliography file | empty (off) | Vault path for a CSL-JSON export, regenerated when references change |
| Citation style | `chicago-author-date` | CSL style for the "copy formatted citation" command |
| Health check scope | all | Which checks the report runs |

### 4.4 Citekey pattern

A subset of Better BibTeX's formula language, so keys match what Zotero users already have.

- Terms joined by `+`.
- `auth` (first author's family name), `.lower` / `.upper` modifiers.
- `authors(n)` (first n family names joined).
- `shorttitle(n, m)`: first n significant title words, the first m capitalized. Stop words match Better BibTeX's list. Apostrophes are removed inside words; other punctuation splits words.
- `veryshorttitle` = `shorttitle(1, 1)`.
- `year`.
- `"literal"` text.
- Keys are ASCII-folded, unsafe characters removed, and collisions get `a`, `b`, `c` suffixes like Better BibTeX.
- An item with no author drops the `auth` term. An item with no date drops `year`.

Acceptance test (`npm run bbt-accuracy`): against the author's 2,961-item Better BibTeX export, the generator reproduces 92.1% of existing keys overall and 97.9% of keys for items added since 2025. Most misses are older keys that Better BibTeX pinned under earlier rules (it used to drop possessive "'s" and single digits). The generator follows current Better BibTeX behaviour.

### 4.5 Note template

Optional template file. Plain `{{name}}` placeholders and `{{#name}}…{{/name}}` sections that render only when the value exists. Available values: `citekey, title, authors, year, publisher, journal, url, doi, isbn, abstract, type`. Properties are written separately through Obsidian's frontmatter API, so the template only controls the body. The built-in template is a title heading, an abstract section when there is one, and an empty annotations section.

## 5. Features by stage

### Stage 1: capture (implemented)

Commands:

- **Add reference**: a dialog takes an ISBN, DOI, URL or arXiv ID, detects which it is, looks up metadata, checks for an existing note with the same identifier, creates the note, and opens it.
- **Complete current reference**: fill and rename the active note from its ISBN, DOI or URL.
- **Process inbox now**: run the inbox handler over every file currently in the inbox.
- **Regenerate citekey for current note**: recompute, rename, and update links.

Automations:

- New Markdown note in the inbox: read its URL, enrich it from the page (or Crossref when the page exposes a DOI), set the web-clip status, compute the citekey, then move and rename it into the references folder with `fileManager.renameFile`, which updates links.
- New PDF in the inbox: read the first pages with Obsidian's bundled PDF.js, find a DOI or ISBN, look it up (falling back to the PDF's title metadata, then the filename), create the note, and file the PDF in the attachments folder under the attachment filename format.
- Property edit in the references folder: when a note gains an ISBN, DOI or URL and has no citekey, complete it. Guarded against loops and against running during Obsidian's startup indexing.

Metadata sources (no API keys):

| Identifier | Primary | Fallback |
|---|---|---|
| ISBN | Open Library (`/api/books?jscmd=data`) | Google Books volumes API |
| DOI | Crossref `/works/{doi}` | doi.org CSL-JSON content negotiation |
| arXiv | arXiv export API | — |
| URL | Page `<meta>` tags: Highwire `citation_*`, Open Graph, Dublin Core, `<title>` | If the page has `citation_doi`, use Crossref |

All requests go through Obsidian's `requestUrl`, which works on mobile and avoids CORS.

### Stage 2: reading round trip (implemented)

- Status change to the "send" status copies the PDF to the tablet folder (desktop). The send records a SHA-256 of the copy, and never overwrites a tablet copy with changes that haven't been brought back.
- A watcher on the tablet folder (desktop, while Obsidian runs, plus a scan on startup) matches returned PDFs by filename, waits until the file stops changing, and compares fingerprints: tablet changed only → returned; both changed → a dialog previews both copies (dates, sizes, annotation counts) and keeps both whichever is chosen. A returned PDF runs the optional pre-extraction command, is copied back over the attachment, sets the "returned" status, then is extracted. Records follow vault renames; a rename made while Obsidian was closed is found through the note's `pdf` link or by content hash.
- Annotation extraction uses PDF.js: highlight, underline, strikeout, squiggly, sticky-note, text-box and rectangle annotations, their colors, comments, replies, page numbers and page labels. Highlighted text comes from the annotation's quadrilaterals intersected with the page's text content, rounded to whole words, with end-of-line hyphenation undone. Pages without text keep their highlights as page embeds. Output follows the color map into callouts with page links (`[[file.pdf#page=N]]`), grouped under page headings, each with a stable block ID derived from page and position, between `<!-- stacks:annotations:start -->` and `<!-- stacks:annotations:end -->` markers. Sets `highlights` and `last_highlighted`; writes nothing when nothing changed.
- Command: **Extract annotations for current note** (from the note or its PDF).
- Command: **Send PDF to tablet folder** for a manual push.
- Command: **Check tablet folder for returned PDFs**.

### Stage 3: citations and maintenance

- **Copy formatted citation** and **Copy citekey as Pandoc citation** (`[@key]`).
- Bibliography export to CSL-JSON (for Pandoc, Quarto and the Pandoc Reference List plugin) using citation.js, regenerated after reference changes with a debounce.
- **Health check** report note: notes without a citekey, duplicate citekeys or DOIs/ISBNs, `pdf` links that don't resolve, PDFs in the attachments folder with no note, items stuck in a status longer than a set number of days.
- **Import Better BibTeX JSON**: the conversion this project used once, generalized. Matches by citekey, then Zotero item key, then exact title; adds properties; creates notes for unmatched items. Dry run first.

## 6. Architecture

```
src/
  main.ts              plugin lifecycle, commands, event wiring
  settings.ts          settings interface, defaults, settings tab
  citekey.ts           pattern parser and generator (pure, unit tested)
  identifiers.ts       detect and normalize ISBN, DOI, arXiv, URL (pure)
  template.ts          body template renderer (pure)
  metadata/
    types.ts           normalized Reference record
    openlibrary.ts, googlebooks.ts, crossref.ts, arxiv.ts, webpage.ts
    lookup.ts          routes an identifier to sources with fallbacks
  library.ts           vault operations: find by identifier, create, enrich, rename, file attachments
  inbox.ts             inbox handlers for .md and .pdf
  pdf.ts               PDF.js text, metadata and annotation reading
  annotations.ts       annotations to Markdown: text under highlights, colors, rendering, marker block (pure)
  extract.ts           writes annotations into a reference note
  roundtrip.ts         tablet send / watch / return / conflict, over a Host interface
  desktop.ts           the Host from Node's fs and child_process (desktop only, loaded lazily)
  ui/AddReferenceModal.ts, ui/ConflictModal.ts
test/                  node:test suites for the pure modules
```

Design rules:

- Pure modules (`citekey`, `identifiers`, `template`, parsers inside each metadata source) take plain data and import nothing from Obsidian, so tests run in Node.
- All vault writes go through `fileManager.processFrontMatter` and `fileManager.renameFile`.
- Event handlers register inside `workspace.onLayoutReady` so the startup scan of existing files never triggers them.
- A per-path in-flight set prevents a handler from reacting to its own writes.
- Desktop-only code (`fs`, `child_process`) is loaded lazily behind `Platform.isDesktopApp`.

## 7. Privacy

The plugin sends identifiers (ISBN, DOI, arXiv ID, URL) to the public services in section 5 and nothing else. No telemetry, no note content, no API keys. The Crossref contact email is only sent when the user sets it.

## 8. Release

- MIT license, `LICENSE` in the repo root.
- Build with esbuild, as in the Obsidian sample plugin. Release assets: `main.js`, `manifest.json`, `styles.css`.
- Beta distribution through BRAT from a GitHub repo, then submission to the community directory after stage 2.
- Plugin id `stacks` (display name Stacks). The earlier `library` id clashed with an existing community plugin.

## 9. Open questions

1. Final plugin name and id.
2. Should the inbox handler leave a processed copy in a "processed" folder, or only move files? Current behaviour: move.
3. ~~Stage 2 matching for returned PDFs: by filename only, or also by a hash recorded when the file was sent?~~ Both: matched by filename, with a hash recorded at send time to detect real changes and divergence.
