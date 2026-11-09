# Stacks

### Your sources. Your ideas. One home.

The paper you saved. The passage that changed your mind. The note that became a talk, a thesis, or your next project. Bring them together in Obsidian.

**Stacks is building a complete research workflow inside your vault: collect sources, read deeply, connect ideas, and write with confidence.**

If Obsidian is where you think, it should be enough to manage the sources behind that thinking, too. That is the ambition: one app for your library and the knowledge you make from it.

[Get started](#install-beta) · [Available today](#available-today) · [The road ahead](#the-road-ahead)

> **Early beta · 0.3.x.** Capture, metadata lookup, manual references, citekeys, PDF filing, library views, annotation extraction, a tablet reading round trip, Zotero import, and bibliography export are available now. Stacks is still growing toward a complete reference manager. In-editor citations are future work.

## Let your reading become part of your thinking

A source deserves a place beside the ideas it inspires. Link an article to a project. Connect an author to a person note. Follow a book into a question, an experiment, or a draft. Use Obsidian's links, properties, search, and Bases to work with your references alongside the rest of your vault.

Each source is an ordinary Markdown note. Its metadata lives in properties; its PDFs live in ordinary folders. Your reading notes stay yours. The library remains useful if you remove the plugin.

Zotero has helped researchers collect, organize, and cite their work for years. Stacks shares that respect for careful research and takes an Obsidian-first approach: bring those essential workflows into the place where your knowledge already lives. The goal is to make a separate reference manager optional for Obsidian users.

## Available today

- **Save a source by identifier.** Paste an ISBN, DOI, arXiv ID, or URL. Stacks looks up metadata, checks for an existing reference, creates a note, and opens it.
- **Turn an inbox into a library.** Drop in a Web Clipper note or a PDF. Clipped notes are enriched and filed; what Web Clipper saved (author, published date, description) fills anything the lookup can't find, which covers sites that turn Stacks away. Looked-up values replace the guesses Web Clipper made from the page, such as its page title; the URL and status are kept. PDFs are checked for a DOI or ISBN in their opening pages, paired with a reference note, and moved into your attachments folder. When a lookup cannot identify a PDF, its document metadata or filename provides a starting point.
- **Complete a reference as you write.** Add an ISBN, DOI, or URL property to a note in your references folder. Stacks can fill missing metadata and name the note for you. Metadata enrichment preserves populated properties and the existing note body.
- **Start with the details that matter.** References come with a title, authors, publication date (`published`), year, abstract, and, where the source has them, publisher, ISBN, or DOI. Book pages on Amazon, Goodreads, and Kobo, GitHub repositories, and news and blog articles are read the way Zotero's translators read them.
- **Add what no lookup can find.** **New reference without a lookup** takes a type, title, authors and date and creates the note and its citekey offline: talks, interviews, older books, internal documents. **Refresh metadata** looks a reference up again and shows each changed field to accept or skip.
- **Keep complete citation data.** Editors, translators, volume, issue, pages, edition, place, series, language, ISSN and access dates are kept when the source has them, each mapped to your own property names. See [citation fields](docs/citation-fields.md).
- **Export a bibliography.** CSL-JSON for Pandoc and Quarto, or BibLaTeX or BibTeX, for the whole library or a filtered project, written on demand or automatically whenever references change.
- **Move from Zotero.** **Import from Zotero** reads a Better BibTeX JSON export, previews what it will do, adds properties to your existing notes without touching their bodies, and can be undone. See [migrating from Zotero](docs/migrating-from-zotero.md).
- **Give sources useful citekeys.** Use a configurable Better BibTeX-style formula, with collision handling. The default is `auth.lower + shorttitle(3, 3) + year`. Citekey generation is available today; inserting and formatting citations is still ahead.
- **Browse with Obsidian Bases.** Choose your library's `.base` file, or create a starter Base. Match fields to your vault's property names and browse your collection with tables, filters, and reading-status views.
- **Turn highlights into notes.** Run **Extract annotations** on a reference and its PDF's highlights, underlines, and comments appear in the note as callouts grouped by page, each linked to its page. Colors map to callout types you choose. Re-extracting updates only Stacks' marked block, so your own writing in the note is never touched. See [Highlights, comments and the reading round trip](docs/annotations.md).
- **Read on a tablet and bring your highlights home (desktop).** Point Stacks at a folder your reading app syncs. Setting a note to `reading` sends the PDF there; when it comes back changed, Stacks files it, sets the status to `reviewing`, and extracts the annotations. If the PDF also changed in the vault, you choose which copy to keep, and the other is saved beside it.
- **Make it fit your vault.** Configure folders, filenames, property mappings, note templates, statuses, and author links. Folder and template settings suggest matching vault paths as you type.
- **Edit many references at once.** Set a status, add or remove a collection, regenerate citekeys, or complete metadata for a selection, a folder, a collection's members, or the rows of a **Stacks batch** view in a Base, always after a preview. **Create library base** writes views for each reading status, unfiled references and missing PDFs. See [collections, library views and batch edits](docs/batch-and-collections.md).
- **Capture offline, sync anywhere.** A clip saved without a connection waits in the inbox and is retried later; duplicate checks see notes that just arrived through sync, so an item isn't filed twice. See [sync, backups and mobile](docs/sync-and-mobile.md) and [searching your library](docs/searching.md).

### From a saved paper to a connected note

1. Run **Stacks: Add reference** and paste a DOI, or drop a PDF into your inbox.
2. Open the reference note, read the PDF in Obsidian (or on your tablet), and run **Extract annotations** to bring your highlights into the note. Add your own thoughts and links around them.
3. Browse your library in a Base, follow connections into your projects, and keep building on what you read.

No separate library database to maintain. The notes and files in your vault are the library.

## The road ahead

The destination is the whole journey: **collect → read → understand → write → cite**.

The next pieces include importing other bibliography files and citing sources while you write. Search, duplicate merging, attachment maintenance, and dependable work across devices matter just as much as the first capture.

| The next step | Proposals to explore |
| --- | --- |
| Bring your library with you | [Bibliography imports](https://github.com/jag3773/obsidian-stacks/issues/17) |
| Capture more of what you find | [Scholarly web capture](https://github.com/jag3773/obsidian-stacks/issues/23), [full-text retrieval](https://github.com/jag3773/obsidian-stacks/issues/24) |
| Return to what mattered | [Highlights into notes](https://github.com/jag3773/obsidian-stacks/issues/22), [full-text search](https://github.com/jag3773/obsidian-stacks/issues/25) |
| Write with your sources | [Citation styles](https://github.com/jag3773/obsidian-stacks/issues/20), [citations while drafting](https://github.com/jag3773/obsidian-stacks/issues/21) |
| Trust a growing collection | [Duplicate merging](https://github.com/jag3773/obsidian-stacks/issues/26), [library health checks](https://github.com/jag3773/obsidian-stacks/issues/28) |
| Keep reading across devices | [Mobile and offline reliability](https://github.com/jag3773/obsidian-stacks/issues/30), [external-reader round trip](https://github.com/jag3773/obsidian-stacks/issues/29) |

The [feature backlog](https://github.com/jag3773/obsidian-stacks/issues?q=is%3Aissue%20is%3Aopen%20label%3Aenhancement) tracks those gaps. It is a set of proposals to prioritize, not a promise that every feature will ship. [PLAN.md](PLAN.md) describes the implementation stages and design choices.

Obsidian already provides the workspace. Stacks can build on Web Clipper, Bases, the PDF viewer, and compatible plugins rather than recreating them. The aim is a coherent research workflow with your vault at its center.

## Install (beta)

Use a recent Obsidian version with **Bases** enabled for the library views.

### With BRAT

1. Install and enable [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. Choose **Add beta plugin** and enter `jag3773/obsidian-stacks`.
3. Enable **Stacks** in Community plugins.

Builds are available on the [releases page](https://github.com/jag3773/obsidian-stacks/releases).

### Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the same release. Put them in `<vault>/.obsidian/plugins/stacks/`, then enable **Stacks**.

**Upgrading from 0.2.x?** The plugin was renamed from Library to Stacks in 0.3.0, and its ID changed from `library` to `stacks`. Disable the old plugin and keep a backup of its folder. To retain your settings, copy `.obsidian/plugins/library/data.json` into the new `stacks` folder before enabling Stacks, then remove the old folder.

**Upgrading from 0.1.x?** The plugin ID changed from `reference-library` to `library` in 0.2.0. Disable the old plugin and keep a backup of its folder. To retain your settings, copy its `data.json` into the new `library` folder before enabling the new version.

### Set up your library

Open the Stacks settings and choose your references, attachments, and inbox folders. Under **Library base**, pick an existing `.base` file or press **Create base**.

When a Base requires one folder, Stacks can use it as the references folder. Negated or ambiguous folder filters leave the configured destination unchanged. Review the field dropdowns so Stacks uses names such as `author`, `source`, or `Citation Key` the way your vault does. Web Clipper's `published` and `description` are recognized as the publication date and abstract. **Create base** preserves your mappings; **Re-read** refreshes the mapping from a selected Base.

<details>
<summary>Example Base to customize</summary>

This example assumes the default folder and property names. The settings command generates a Base using your own mappings.

```yaml
filters:
  and:
    - file.inFolder("References")
    - file.hasProperty("citekey")
formulas:
  name: file.asLink(title)
properties:
  formula.name:
    displayName: Title
views:
  - type: table
    name: Library
    groupBy:
      property: status
      direction: ASC
    order: [formula.name, authors, year, type, pdf, status]
  - type: table
    name: Queue
    filters: 'status == "queued"'
    order: [formula.name, authors, year, added]
```

</details>

## Metadata and privacy

Stacks uses Open Library and Google Books for ISBNs, Crossref and doi.org for DOIs, arXiv for arXiv IDs, GitHub's public API for repositories, and a web page's own metadata for other URLs. No API keys are required.

For a web page, Stacks trusts the most specific source first:

1. **Site readers** for Amazon, Goodreads, and Kobo book pages and GitHub repositories, which keep their best data outside the standard tags.
2. **schema.org JSON-LD**, including a book's edition (`workExample`) and author references elsewhere in the page's data.
3. **Standard tags:** Highwire `citation_*` (used by Google Scholar), Dublin Core, PRISM, and Open Graph.
4. **The page body,** as a last resort: bylines (microdata, `rel="author"`, author-page links) and the article's `<time>`.

A page that names a DOI is looked up through Crossref. A book page that names an ISBN gets a missing date, publisher, or description from Open Library and Google Books; the page's own values win. A bot check served in place of the page (Kobo, Cloudflare, an Amazon captcha) is recognized and ignored.

Note bodies, PDF text, and annotations are processed locally. The optional pre-extraction command runs on your computer, and the tablet round trip only copies files between your vault and a folder you choose. Lookups send the identifier or URL to the relevant service or website; identifiers discovered in a PDF may also be looked up. An optional Crossref contact email is sent only when you configure it. Stacks has no telemetry or required cloud account.

## Build and contribute

```sh
git clone https://github.com/jag3773/obsidian-stacks.git
cd obsidian-stacks
npm ci
npm run build
```

Copy the three plugin files into your vault as described above. For development:

```sh
npm run dev      # watch build
npm test         # pure-module and vault/settings tests
npm run bbt-accuracy -- path/to/BetterBibTeX.json 2025
```

Tests use an in-memory Obsidian stand-in for vault and settings behavior. Real-vault testing is valuable, especially for reading workflows, mobile use, and library views.

Have a workflow that still sends you back to a separate reference manager? [Describe it in an issue](https://github.com/jag3773/obsidian-stacks/issues/new). Concrete examples help shape what Stacks builds next.

<details>
<summary>Publishing a release</summary>

Set the same new version in `manifest.json` and `package.json`, add it to `versions.json`, and commit. Push a matching, unused version tag. The Release workflow runs tests, builds, and publishes a pre-release containing `main.js`, `manifest.json`, and `styles.css` for BRAT and manual installation.

</details>

## License

MIT. See [LICENSE](LICENSE).
