# How to migrate from Zotero

This guide walks through moving an established Zotero library into an Obsidian vault so that Stacks and Obsidian Bases replace Zotero for day-to-day work. It follows a real migration of a personal library of a few thousand items: books, articles, web pages, videos and documents, many with PDFs and highlights.

The Stacks importer, **Stacks: Import from Zotero**, does the conversion for you (steps 6 and 7) after showing a preview. This guide explains the decisions it asks for and what to check afterwards. It is safe to follow in stages, and you can stop after any stage with a working vault.

## The approach in one paragraph

Keep one Markdown note per reference, named by its citekey. Put the metadata in properties so Bases can query it. Leave every note body untouched. Prove the format on a small sample before converting everything, convert from a Better BibTeX export, then clean up citekey mismatches and duplicates with link-safe renames. Keep Zotero installed and untouched until you're confident.

## Before you start

You will need:

- **Zotero with Better BibTeX**, for stable citekeys and a complete JSON export.
- **Obsidian 1.9 or later** with the core Bases plugin enabled.
- **A backup you can roll back.** Git is ideal: commit before and after each stage so any step is one revert. Obsidian Sync version history or a copy of the vault also works.
- **The Stacks plugin**, with its references folder pointing at your literature notes and the same citekey formula as Better BibTeX.
- **Optional:** existing literature notes from the Zotero Integration plugin. This guide assumes you have them, because it is the common case. If you don't, step 6 creates notes for every item.

## Step 1: List what Zotero does for you

Before changing anything, write down each job Zotero does in your workflow and decide what replaces it, or whether to drop it. A typical list:

| Job | In Zotero | In the vault |
|---|---|---|
| Capture metadata | Browser connector | Stacks: **Add reference** (ISBN, DOI, arXiv, URL), Web Clipper into the inbox |
| Stable identifier | Better BibTeX citekey | Same citekey formula, used as the note filename |
| File PDFs | ZotFile / attachment renaming | Stacks files inbox PDFs into the attachments folder by citekey |
| Collections, saved searches | Zotero UI | `collections` and `status` properties, plus Base views |
| Reading queue | A "to read" collection or tag | `status: queued` |
| Highlights into notes | Zotero Integration plugin | Stacks: **Extract annotations**, and the tablet reading round trip ([docs/annotations.md](annotations.md)) |
| Citations | Better BibTeX export | **Stacks: Export bibliography** (CSL-JSON, BibLaTeX or BibTeX), optionally automatic; in-editor citations are planned in [#20](https://github.com/jag3773/obsidian-stacks/issues/20) |
| Full-text PDF search | Zotero index | Omnisearch + Text Extractor plugins ([#25](https://github.com/jag3773/obsidian-stacks/issues/25)) |
| Shared group libraries | Zotero groups | Out of scope; share a vault instead |

If a job you rely on is still "planned", keep Zotero for that one job during the transition.

## Step 2: Decide the note format

Settle these before converting anything, because every later step depends on them.

1. **Folder and filenames.** Keep your existing literature-note folder and attachment folder if you have them. Wikilinks resolve by filename, so links from the rest of your vault keep working. Name notes by citekey.
2. **Properties.** A set that worked well:

   | Property | Example | Notes |
   |---|---|---|
   | `citekey` | `doeExampleBook2006` | Matches the filename |
   | `type` | `book` | book, chapter, article, webpage, video, audio, document, report, thesis, presentation, paper, software, image, reference |
   | `title` | Full title | |
   | `authors` | `["[[Jane Doe]]"]` | Links connect to people notes |
   | `year` | `2006` | Number, for sorting and grouping |
   | `publisher`, `journal`, `isbn`, `doi`, `url` | | Only when present |
   | `collections` | `["[[Climate]]", "[[Leadership]]"]` | Links to topic notes, so a reference can be in several |
   | `tags` | `[Fiction]` | Broad categories only |
   | `status` | `queued` | See below |
   | `owned` | `true` | Optional, for books you own in print |
   | `pdf`, `attachments` | `"[[doeExampleBook2006.pdf]]"` | Links, so they open from the note and the Base |
   | `highlights`, `last_highlighted` | `42`, `2024-03-24` | Counted from existing annotations |
   | `added` | `2022-12-14` | Zotero's date added |

3. **Status vocabulary.** One property replaces the collections, tags and saved searches you used to track reading. For example: `queued → reading → reviewing → processed`, plus `shelved` as the catch-all for things you keep but aren't working through.

Only write a property when it has a value, so notes don't fill up with empty keys.

## Step 3: Export from Zotero

1. In Zotero, choose **File → Export Library…**
2. Choose the format **Better BibTeX JSON**. Leave **Export Files** unchecked; your PDFs are already on disk.
3. Save the file inside the vault, so the importer can read it.
4. Copy your citekey formula from Zotero → Settings → Better BibTeX → Citation keys, and use the same formula in the Stacks settings.

The export gives you what existing notes often lack: the real item type, ISBN and DOI, Zotero's date added, collection membership and attachment paths. Without it you can still derive properties from the notes themselves (the bibliography line, inline `Field::` lines, highlight dates), but item types and dates will be guesses.

## Step 4: Convert a representative sample first

Pick 30 to 40 notes that cover every combination you care about, not a random slice:

- each item type you have (books, articles, web pages, videos, documents)
- each reading state (queued, in review, finished, never read)
- books with and without PDFs, and with many highlights
- edge cases: notes whose highlights live in another note (for example Kindle imports), items with no bibliography, image attachments, and any note whose frontmatter Obsidian can't read

Copy them into a separate folder (or a copy of your vault), point the Stacks references folder at it, and run **Stacks: Import from Zotero** on just those notes (step 6 explains the dialog; turn off **Create notes for items without one** so the whole library isn't created there). The import adds properties and leaves bodies, `aliases` and `cssclass` exactly as they were.

Then build a Base (`Library.base`) that shows only converted notes, so the sample is all you see:

```yaml
filters:
  and:
    - file.inFolder("References")
    - file.ext == "md"
    - file.hasProperty("citekey")
formulas:
  name: file.asLink(title)
  pdf_icon: 'if(pdf, link(pdf.toString().replace("[[", "").replace("]]", ""), "📄"), "")'
  links_in: file.backlinks.length
properties:
  formula.name:
    displayName: Title
  formula.pdf_icon:
    displayName: PDF
  formula.links_in:
    displayName: Backlinks
views:
  - type: table
    name: Library
    groupBy:
      property: status
      direction: ASC
    order: [formula.name, authors, year, collections, highlights, formula.links_in, formula.pdf_icon]
  - type: table
    name: Queue
    filters: 'status == "queued"'
    order: [formula.name, authors, year, formula.pdf_icon, added]
    sort:
      - property: added
        direction: ASC
  - type: table
    name: Reviewing
    filters: 'status == "reviewing"'
    order: [formula.name, authors, highlights, last_highlighted]
  - type: cards
    name: Bookshelf
    filters: 'type == "book"'
    order: [formula.name, authors, year, status]
```

Two details matter here:

- **Clickable titles.** A plain `title` property isn't a link in a Base. The `name` formula (`file.asLink(title)`) shows the title and opens the note.
- **Clickable PDFs.** The `pdf_icon` formula turns the `pdf` property into a link that opens the PDF.

Live with the sample for a few days. This is where you find out which statuses, collections and views you actually want.

## Step 5: Turn what you learned into mapping rules

Most libraries need a few of these:

- **Collections that are really a workflow** ("To read", "Read", "In review") become `status` values, not collections.
- **A catch-all collection** that holds most of the library usually means the same as your catch-all status. Drop it.
- **Tags that describe a fact about the item** (for example an ownership tag) become properties such as `owned: true`.
- **Status precedence.** An item still in your "to read" collection that already has highlights has been read. Let highlights win, and keep a note of these conflicts for review.

## Step 6: Import the whole library

Run **Stacks: Import from Zotero (Better BibTeX JSON)**, choose the export, and press **Read**. Then turn the rules from step 5 into the dialog's choices:

| Rule | In the dialog |
|---|---|
| Workflow collections ("To read", "Read") | Set each collection to **Status: …** |
| A catch-all collection | **Drop**, and set **Everything else** to your catch-all status |
| Topic collections | **Keep as collection**: they become links in `collections` |
| Tags that are facts (`Own`) | A tag rule: `Own = owned: true` |
| Tags that are workflow (`_reviewing`, `Reviewed in 2024`) | Status rules, highest priority first: `_reviewing = status: reviewing`, then `Reviewed-in-* = status: processed` |
| Highlights mean "read" | **Notes with highlights**: your "processed" status |

Press **Preview**. Nothing is written yet: the preview counts how each note matched its Zotero item, what will be created, renamed and repaired, and what needs your attention. Change the choices and preview again until the counts look right, then **Import**.

What the import does, following what a real migration needed:

- **Matching.** Each note is matched to its item by filename = citekey, then by the note's `citekey` property, then by the item key in its `zotero://select/library/items/KEY` link, then by a DOI or ISBN found only once, then by an exact title found only once. The report says how each matched. Other bibliography files (CSL-JSON, BibTeX, RIS) use the same matching: see [importing bibliography files](importing.md).
- **Bodies are never changed.** Only properties are added. Existing values are kept unless you turn on **Zotero's values win**, which applies to bibliographic fields only; your status, collections and tags are filled in, never replaced.
- **Broken frontmatter** (generated aliases with unescaped quotes) is repaired: every line that still parses is kept and `aliases` is rebuilt from the note's heading.
- **Items with no note** get one (title, abstract and any Zotero child notes), unless you turn that off. An item whose title matches an existing note is listed as a probable duplicate inside Zotero instead.
- **Group-library notes** aren't in a personal export; they're listed and left alone. So are notes whose item was deleted from Zotero.
- **Attachments** are linked when the file is in the vault (found by filename). Zotero's web snapshots stay in Zotero's storage; anything else outside the vault is listed, so you can move it in and import again.
- **Annotations** made in Zotero's PDF reader aren't in a Better BibTeX export. Highlights already in your notes are untouched; for the rest, use Zotero's **File → Export PDF…**, which writes the annotations into the PDF, keep that PDF in the vault, and run **Stacks: Extract annotations** on its note.

The import writes a report note beside your references folder with every list, and a backup in the plugin's folder. **Stacks: Undo last import** restores every changed note exactly, renames notes back and moves created notes to the trash.

**Protect your work anyway:** commit before and after the run if your vault is in git. The import's output is deterministic, so the whole run is one reviewable commit. Running it again changes nothing unless the export or your choices changed.

**If your vault has automations that watch file modification times** (an agent that processes recently changed notes, a sync rule), pause them or move their marker past the run. An import touches every matched note.

## Step 7: Fix citekey mismatches and duplicates

Better BibTeX keys drift: keys change when titles are corrected or when the formula changes. The report lists every note whose filename isn't its item's current key.

- **To rename them,** turn on **Rename notes to current citekeys**. Notes are renamed through Obsidian, so links update, and their `citekey` follows. A key with characters a filename can't hold (such as `:`) is left as it is and listed.
- **Duplicates,** where a note already exists under the new key, are never renamed onto each other. This usually means the item was re-imported at some point: the old note has the backlinks, the new one has the fresh metadata. The report lists each pair. For each:
  1. Repoint every link to the old note so it points to the kept note (the one named by the current key).
  2. Copy any annotations or prose that only the old note has into the kept note.
  3. Move the old note to Obsidian's trash.

Check afterwards that no links to the removed notes remain.

## Step 8: Remove the scaffolding

Once you've worked through the import report, delete it. Then update anything that read the old format:

- **Dataview queries** on inline fields (`Topics::`, `Tags::`) can become embedded Base views, for example `![[Library.base#Queue]]`.
- **Scripts or AI agents** that found new items by modification time can use properties instead. For example: notes where `status` is `processed` and an `ingested` property is empty.
- **Vault instructions or READMEs** that describe the old Zotero export as read-only should explain the new properties and Base.

## Step 9: Set up Stacks for new items

In the Stacks settings:

1. Point the references folder, attachments folder and inbox at your folders. If you made a Base, choose it under **Library base** so Stacks matches its property names.
2. Use the same citekey formula as Better BibTeX, so new keys match old ones.
3. Set your statuses, the default status for new items, and the status for web clips. Clips you want processed straight away can use your "processed" status; clips you only want to keep can use your catch-all.
4. Try it: **Stacks: Add reference** with an ISBN or DOI, and drop a PDF or a Web Clipper note into the inbox.

## Step 10: Run both, then retire Zotero

- For a few weeks, add new items through Stacks only. Anything you find yourself missing is either a setting or a gap worth an issue.
- **Don't re-import a converted item with Zotero Integration's "Import Literature Note".** It rewrites the whole file and drops the new properties.
- When you're ready, archive a final Better BibTeX export and a copy of your Zotero data directory, then disable the Zotero Integration plugin.
- Your PDFs can keep their filenames. If Zotero still points at them, leave them alone until Zotero is gone.

## Checklist

- [ ] Backup or git commit in place
- [ ] Jobs Zotero does for you listed, each with a replacement or a decision to drop it
- [ ] Properties, status vocabulary and folders decided
- [ ] Better BibTeX JSON exported, citekey formula noted
- [ ] Sample converted and a Base built; format confirmed
- [ ] Mapping rules for collections, tags and status precedence written down
- [ ] Import previewed, then run; report reviewed
- [ ] Citekey renames and duplicate merges done through link-safe operations
- [ ] Import report worked through and deleted; old queries, scripts and agents updated
- [ ] Stacks configured and tested on a new item
- [ ] Zotero archived and retired
