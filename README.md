# Library for Obsidian

A reference manager that keeps your library in plain Markdown. Each book, article or web page is one note. Its metadata lives in properties, its PDF sits in a folder next to it, and you browse the whole collection with Obsidian Bases. If you uninstall the plugin, your library still works.

Status: early (0.1). Capture features are in place. The reading round trip (send a PDF to a tablet, pull highlights back into the note) and citation export are planned; see [PLAN.md](PLAN.md).

## What it does today

- **Add reference.** Paste an ISBN, DOI, arXiv ID or URL. The plugin looks up the metadata, checks for a duplicate, creates the note with a citekey filename, and opens it.
- **Process the inbox.** Drop a Web Clipper note or a PDF into your inbox folder. Notes get enriched from their URL and filed. PDFs are scanned for a DOI or ISBN, looked up, given a note, and moved to your attachments folder.
- **Complete a note from its properties.** Create a note in your references folder, type an `isbn`, `doi` or `url` property, and the plugin fills in the rest and renames it.
- **Citekeys.** Uses a Better BibTeX-compatible formula (default `auth.lower + shorttitle(3, 3) + year`), so new keys match the style of an existing Zotero library.

The plugin only fills empty properties. It never overwrites what you typed.

## Everything is a setting

Folders, filename formats, citekey pattern, statuses and the note template are configurable. Folder and template settings suggest matching paths from your vault as you type.

**Point it at your library's base.** Under **Library base**, choose the `.base` file that shows your library, or press **Create base** to make one. The plugin reads the folder the base requires (a `file.inFolder(...)` filter every note must match; negated or either/or folders are ignored) and the properties it uses, and matches each field it writes to one of them, by name or a common synonym (`author` for authors, `source` for url, `date` for year, and so on). Each match is a dropdown, so you only change the ones it got wrong. A field with no matching property is created under the plugin's default name. **Create base** keeps your current mapping, and records each field's name in the base so **Re-read** recovers it.

## Metadata sources

Open Library and Google Books (ISBN), Crossref and doi.org (DOI), arXiv, and a web page's own meta tags (URL). No API keys. The plugin sends only the identifier you looked up. Set a Crossref contact email if you want to use Crossref's polite pool; nothing is sent otherwise.

## Install (beta)

Until it is in the community directory, build it from source:

1. `npm install && npm run build`
2. Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/library/`.
3. Enable **Library** in Community plugins.

**BRAT:** BRAT installs from GitHub releases, so it works once a release is listed on the [releases page](https://github.com/jag3773/obsidian-library/releases). If none is listed yet, use the steps above. When one is: install BRAT, choose **Add beta plugin**, enter `jag3773/obsidian-library`, then enable **Library**.

## Suggested Base

**Create base** in settings writes one like this for you, using your folder and property names. To write it by hand, create `Library.base` anywhere in your vault:

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
npm test         # unit and vault-level tests
npm run bbt-accuracy -- path/to/BetterBibTeX.json 2025   # compare generated keys with a Zotero export
```

`npm test` also runs vault-level tests (duplicate detection, inbox filing, attachment naming, timers and unload) against an in-memory stand-in for the Obsidian API in `test/mocks/obsidian.ts`.

### Releasing

Set the same version in `manifest.json` and `package.json`, add it to `versions.json`, commit, then push a matching tag:

```
git tag 0.1.0 && git push origin 0.1.0
```

The Release workflow runs the tests, builds, and publishes a pre-release with `main.js`, `manifest.json` and `styles.css`, which is what BRAT downloads.

## License

MIT. See [LICENSE](LICENSE).
