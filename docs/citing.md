# Citing your sources

Stacks can format citations and bibliographies in a citation style, and insert citations into the note you're writing. When the draft is finished, the bibliography export and Pandoc or Quarto turn it into a document with formatted citations and a reference list. Nothing here needs Zotero.

## Formatted citations and bibliographies

| Command | Copies |
|---|---|
| **Copy formatted citation for current reference** | The in-text citation for the open reference note, e.g. `(Porter and Kramer 2011)`. With a note style, the footnote text. |
| **Copy formatted bibliography** | A reference list. What it covers depends on the open file (see below). |
| **Copy citekey as Pandoc citation** | `[@citekey]` for the open reference note. |

**Copy formatted bibliography** covers:

- **A reference note:** that reference.
- **A draft or any other note:** the references it cites, as `[[links]]` to reference notes or Pandoc `[@citekey]` citations, in the order they first appear. Citekeys that match no reference note are listed in the message.
- **A `.base` file:** the reference notes in the folder the base requires (`file.inFolder(...)`), or the whole library when it doesn't require one. A view's other filters aren't applied, because plugins can't read the rows a Bases view shows. To format just what a view shows, select those notes in the file explorer instead.

The same item is in the file explorer's menu: right-click a folder, a base or a note, or select several reference notes and right-click.

The clipboard gets both HTML and plain text. Pasting into a word processor or Google Docs keeps italics; pasting into a plain text editor gives clean text. Where the platform can't write HTML to the clipboard, plain text is copied.

After copying, the message lists references with missing details their type needs (for example a book without a date), using the checks in [citation fields](citation-fields.md#what-each-type-needs). The citation is still copied, with whatever the style does about the gap, such as "n.d." for no date.

### Styles and languages

The built-in style is the *Chicago Manual of Style* author-date style, in US English. To use another style:

1. Download its `.csl` file from the [Zotero style repository](https://www.zotero.org/styles) or the [CSL styles repository](https://github.com/citation-style-language/styles), and put it in your vault.
2. In the Stacks settings, under **Citations**, set **Citation style** to the file.

Author-date (APA, Chicago author-date), numeric (IEEE, Vancouver) and note styles (Chicago notes and bibliography) all work. A dependent style (one that only points at another, a few kilobytes long) can't be used on its own: download the style it names as its parent.

For another language's terms and date formats, download the locale file (for example `locales-de-DE.xml`) from the [CSL locales repository](https://github.com/citation-style-language/locales) and set **Citation locale** to it.

Formatting uses [citeproc-js](https://github.com/Juris-M/citeproc-js), the processor Zotero uses. It is loaded the first time you format something, so it doesn't slow Obsidian's start.

## Inserting citations while you write

Run **Insert citation** in a note (assign it a hotkey in Obsidian's settings to keep your hands on the keyboard). Search by citekey, title, author or year; accents don't matter, so `garcia` finds García Márquez. Press Enter to insert the citation at the cursor.

**Insert citations as** in the settings chooses what is written:

| Setting | Inserts | Good for |
|---|---|---|
| Pandoc | `[@porterCreatingSharedValue2011]` | Drafts you'll publish with Pandoc or Quarto (the default) |
| Link | `[[porterCreatingSharedValue2011]]` | Notes that should connect to the reference note in the graph and backlinks |
| Both | `[@porterCreatingSharedValue2011] [[porterCreatingSharedValue2011]]` | Both at once |

When a reference note's filename isn't its citekey, the link goes to the note and shows the citekey: `[[References/Porter 2011|porterCreatingSharedValue2011]]`.

**Page numbers.** Turn on **Ask for a page** to be asked for a locator after picking a reference. A number is a page (`12` becomes `[@key, p. 12]`, `12-14` becomes `pp. 12-14`); other locators are written as typed (`chap. 3`, `sec. 2`). Leave it empty for none; Escape cancels the insertion.

**Several references in one citation.** Put the cursor inside a Pandoc citation and run **Insert citation** again: the new reference joins it, giving `[@porter2011; @hooker1989]`.

Pandoc's other forms can be typed by hand and are understood everywhere Stacks reads citations: a prefix or suffix (`[see @key, p. 12, for details]`) and a suppressed author (`[-@key]`).

## From a note to a finished document

This path uses only the vault, Stacks and [Pandoc](https://pandoc.org) (or [Quarto](https://quarto.org), which runs Pandoc).

1. **Write.** Cite with **Insert citation** in Pandoc form, for example in `Drafts/essay.md`.
2. **Export the bibliography.** Run **Export bibliography** with the format set to CSL-JSON. By default it writes `library.json` at the root of the vault. Turn on **Export automatically** to keep it current. For a project, **Only references where** limits the file to, say, `collections: Essay`.
3. **Render.**

   With Pandoc, from the vault folder:

   ```sh
   pandoc Drafts/essay.md --citeproc --bibliography=library.json -o essay.docx
   ```

   Pandoc formats in Chicago author-date unless told otherwise. For another style, add `--csl=styles/apa.csl` (the same file Stacks uses works).

   With Quarto, name the bibliography in the draft's properties (paths are relative to the draft):

   ```yaml
   ---
   title: My essay
   bibliography: ../library.json
   csl: ../styles/apa.csl
   ---
   ```

   then run `quarto render Drafts/essay.md --to docx` (or `html`, `pdf`). Pandoc reads the same `bibliography` and `csl` properties, so with them in the note `pandoc Drafts/essay.md --citeproc -o essay.docx` is enough when run from the draft's folder.

The reference list is added at the end of the document. Put `::: {#refs}` and `:::` on their own lines where you want it instead.

**Missing references.** A citekey that isn't in the bibliography file isn't fatal: Pandoc and Quarto print a warning naming the key (`citation missingKey not found`) and show the key with a question mark in the document where the citation would be. Check for these before sending a document anywhere. Inside Obsidian, **Copy formatted bibliography** on the draft lists the citekeys that match no reference note. A key is missing when the reference isn't in the vault, has no citekey, was left out by the export filter, or the export hasn't run since it was added.

**Links in the published document.** Pandoc doesn't know Obsidian's `[[links]]`; with the Link or Both setting they appear as text. Pandoc 3 can turn them into ordinary links with `-f markdown+wikilinks_title_after_pipe`, or remove them before rendering.

**Changing a citekey.** **Regenerate citekey** renames the note, and Obsidian updates `[[links]]` to it. Pandoc citations (`[@oldkey]`) are plain text and aren't updated: search the vault for the old key and replace it.
