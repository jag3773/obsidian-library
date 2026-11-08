# Reference Library for Obsidian

A reference manager that keeps your library in plain Markdown. Each book, article or web page is one note. Its metadata lives in properties, its PDF sits in a folder next to it, and you browse the whole collection with Obsidian Bases. If you uninstall the plugin, your library still works.

Status: early (0.1). Capture features are in place. The reading round trip (send a PDF to a tablet, pull highlights back into the note) and citation export are planned; see [PLAN.md](PLAN.md).

## What it does today

- **Add reference.** Paste an ISBN, DOI, arXiv ID or URL. The plugin looks up the metadata, checks for a duplicate, creates the note with a citekey filename, and opens it.
- **Process the inbox.** Drop a Web Clipper note or a PDF into your inbox folder. Notes get enriched from their URL and filed. PDFs are scanned for a DOI or ISBN, looked up, given a note, and moved to your attachments folder.
- **Complete a note from its properties.** Create a note in your references folder, type an `isbn`, `doi` or `url` property, and the plugin fills in the rest and renames it.
- **Citekeys.** Uses a Better BibTeX-compatible formula (default `auth.lower + shorttitle(3, 3) + year`), so new keys match the style of an existing Zotero library.

The plugin only fills empty properties. It never overwrites what you typed.

## Everything is a setting

Folders, filename formats, citekey pattern, statuses, the note template and even the property names are configurable. If your vault uses `author` instead of `authors`, map it in settings.

## Metadata sources

Open Library and Google Books (ISBN), Crossref and doi.org (DOI), arXiv, and a web page's own meta tags (URL). No API keys. The plugin sends only the identifier you looked up. Set a Crossref contact email if you want to use Crossref's polite pool; nothing is sent otherwise.

## Install (beta)

Until it is in the community directory:

1. Install the BRAT plugin.
2. In BRAT, add this repository: `jag3773/obsidian-library`.
3. Enable **Reference Library** in Community plugins.

Or build it yourself: `npm install && npm run build`, then copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/reference-library/`.

## Suggested Base

Create `Library.base` anywhere in your vault:

```yaml
filters:
  and:
    - file.inFolder("References")
    - file.hasProperty("citekey")
formulas:
  name: file.asLink(title)
  pdf_icon: 'if(pdf, link(pdf.toString().replace("[[", "").replace("]]", ""), "📄"), "")'
properties:
  formula.name:
    displayName: Title
  formula.pdf_icon:
    displayName: PDF
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
```

## Development

```
npm install
npm run dev      # watch build
npm test         # unit tests for citekeys, identifiers, templates and metadata parsers
npm run bbt-accuracy -- path/to/BetterBibTeX.json 2025   # compare generated keys with a Zotero export
```

## License

MIT. See [LICENSE](LICENSE).
