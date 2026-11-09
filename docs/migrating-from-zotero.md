# How to migrate from Zotero

This guide walks through moving an established Zotero library into an Obsidian vault so that Library and Obsidian Bases replace Zotero for day-to-day work. It follows a real migration of a personal library of a few thousand items: books, articles, web pages, videos and documents, many with PDFs and highlights.

Library does not yet have a one-click importer; that work is tracked in [#18](https://github.com/jag3773/obsidian-library/issues/18). Until it lands, this is the manual path. It is safe to follow in stages, and you can stop after any stage with a working vault.

## The approach in one paragraph

Keep one Markdown note per reference, named by its citekey. Put the metadata in properties so Bases can query it. Leave every note body untouched. Prove the format on a small sample before converting everything, convert from a Better BibTeX export, then clean up citekey mismatches and duplicates with link-safe renames. Keep Zotero installed and untouched until you're confident.

## Before you start

You will need:

- **Zotero with Better BibTeX**, for stable citekeys and a complete JSON export.
- **Obsidian 1.9 or later** with the core Bases plugin enabled.
- **A backup you can roll back.** Git is ideal: commit before and after each stage so any step is one revert. Obsidian Sync version history or a copy of the vault also works.
- **The Obsidian CLI** (Obsidian 1.12+, Settings → General → Command line interface) for renames that update links.
- **Optional:** existing literature notes from the Zotero Integration plugin. This guide assumes you have them, because it is the common case. If you don't, step 6 creates notes for every item.

## Step 1: List what Zotero does for you

Before changing anything, write down each job Zotero does in your workflow and decide what replaces it, or whether to drop it. A typical list:

| Job | In Zotero | In the vault |
|---|---|---|
| Capture metadata | Browser connector | Library: **Add reference** (ISBN, DOI, arXiv, URL), Web Clipper into the inbox |
| Stable identifier | Better BibTeX citekey | Same citekey formula, used as the note filename |
| File PDFs | ZotFile / attachment renaming | Library files inbox PDFs into the attachments folder by citekey |
| Collections, saved searches | Zotero UI | `collections` and `status` properties, plus Base views |
| Reading queue | A "to read" collection or tag | `status: queued` |
| Highlights into notes | Zotero Integration plugin | Planned: [#22](https://github.com/jag3773/obsidian-library/issues/22), [#29](https://github.com/jag3773/obsidian-library/issues/29) |
| Citations | Better BibTeX export | Planned: [#19](https://github.com/jag3773/obsidian-library/issues/19), [#20](https://github.com/jag3773/obsidian-library/issues/20) |
| Full-text PDF search | Zotero index | Omnisearch + Text Extractor plugins ([#25](https://github.com/jag3773/obsidian-library/issues/25)) |
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
3. Save the file somewhere in or near the vault.
4. Copy your citekey formula from Zotero → Settings → Better BibTeX → Citation keys, and use the same formula in Library's settings.

The export gives you what existing notes often lack: the real item type, ISBN and DOI, Zotero's date added, collection membership and attachment paths. Without it you can still derive properties from the notes themselves (the bibliography line, inline `Field::` lines, highlight dates), but item types and dates will be guesses.

## Step 4: Convert a representative sample first

Pick 30 to 40 notes that cover every combination you care about, not a random slice:

- each item type you have (books, articles, web pages, videos, documents)
- each reading state (queued, in review, finished, never read)
- books with and without PDFs, and with many highlights
- edge cases: notes whose highlights live in another note (for example Kindle imports), items with no bibliography, image attachments, and any note whose frontmatter Obsidian can't read

For each note, add the properties from step 2 to the frontmatter and leave the body exactly as it was. Keep the existing `aliases` and `cssclass`.

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

## Step 6: Convert the whole library

Run the conversion over every note, using the export as the source of truth and the note itself as the fallback.

**Match each note to its Zotero item in this order:**

1. filename equals the Better BibTeX citekey
2. the Zotero item key in the note's `zotero://select/library/items/KEY` link
3. an exact, unique title match

**Handle the cases that will come up:**

- **Items with no note.** Create a minimal note (title heading, abstract, empty annotations section) with properties from the export.
- **Duplicates inside Zotero.** If an unmatched item has the same title as an existing note, don't create a second note. List it so you can delete the duplicate in Zotero.
- **Notes with no Zotero item.** Items from group libraries aren't in a personal export, and some items were deleted after import. Derive their properties from the note and flag them.
- **Broken frontmatter.** Generated `aliases` with unescaped quotes are common. Repair them rather than skipping the note.
- **Changed citekeys.** Keep the existing filename for now and record the new key. Step 7 deals with these.

**Protect your work:**

- Commit before the run.
- Write only frontmatter. Afterwards, compare every note body against the pre-run copy; any difference is a bug.
- Add temporary flags (for example `migration_notes`) on anything that needs a decision, and a temporary Base view that lists them.
- Commit after the run.

**If your vault has automations that watch file modification times** (an agent that processes recently changed notes, a sync rule), pause them or move their marker past the run. A full conversion touches every note.

## Step 7: Fix citekey mismatches and duplicates

Better BibTeX keys drift: keys change when titles are corrected or when the formula changes. Decide whether filenames should follow the current Zotero keys. If so, sort the mismatches into two groups.

**Plain renames,** where nothing exists under the new key. Rename through Obsidian so every link updates (with "Automatically update internal links" turned on):

```sh
obsidian vault="My Vault" rename path="References/oldKey2019.md" name="newKey2019"
```

Set the `citekey` property to the new key as well. Keys containing characters that can't be in a filename, such as `:`, can't become filenames; set `citekey` back to the filename for those.

**Duplicates,** where a note already exists under the new key. This usually means the item was re-imported at some point: the old note has the backlinks, the new one has the fresh metadata. For each pair:

1. Repoint every link to the old note so it points to the kept note (the one named by the current key).
2. Copy any annotations or prose that only the old note has into the kept note.
3. Move the old note to Obsidian's trash: `obsidian vault="My Vault" delete path="References/oldKey2019.md"`.

Check afterwards that no links to the removed notes remain.

## Step 8: Remove the scaffolding

Once you've reviewed the flagged items, delete the temporary properties and the review view. Then update anything that read the old format:

- **Dataview queries** on inline fields (`Topics::`, `Tags::`) can become embedded Base views, for example `![[Library.base#Queue]]`.
- **Scripts or AI agents** that found new items by modification time can use properties instead. For example: notes where `status` is `processed` and an `ingested` property is empty.
- **Vault instructions or READMEs** that describe the old Zotero export as read-only should explain the new properties and Base.

## Step 9: Set up Library for new items

In Library's settings:

1. Point the references folder, attachments folder and inbox at your folders. If you made a Base, choose it under **Library base** so Library matches its property names.
2. Use the same citekey formula as Better BibTeX, so new keys match old ones.
3. Set your statuses, the default status for new items, and the status for web clips. Clips you want processed straight away can use your "processed" status; clips you only want to keep can use your catch-all.
4. Try it: **Library: Add reference** with an ISBN or DOI, and drop a PDF or a Web Clipper note into the inbox.

## Step 10: Run both, then retire Zotero

- For a few weeks, add new items through Library only. Anything you find yourself missing is either a setting or a gap worth an issue.
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
- [ ] Full conversion run; note bodies verified unchanged
- [ ] Citekey renames and duplicate merges done through link-safe operations
- [ ] Temporary flags and views removed; old queries, scripts and agents updated
- [ ] Library configured and tested on a new item
- [ ] Zotero archived and retired
