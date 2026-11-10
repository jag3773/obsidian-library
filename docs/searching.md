# Searching your library

Stacks doesn't build a search index. Your references are Markdown notes, so Obsidian's search already covers most of the library, and existing plugins add full-text search inside PDFs.

## What core search already finds

Obsidian's built-in search covers every reference note:

- **Metadata.** Search properties directly, for example `[authors:Lovelace]`, `[year:1843]` or `[status:reading]`. Titles, abstracts and any notes you wrote are ordinary text.
- **Your highlights and comments.** **Extract annotations** writes a PDF's highlighted passages and your comments into the reference note as Markdown (see [annotations](annotations.md)). Core search finds them like any other text, and each result links to its page in the PDF.

What core search doesn't read is the text of the PDFs themselves.

## Full text of PDFs: Omnisearch and Text Extractor

For search inside PDFs, use two community plugins together:

- [Text Extractor](https://github.com/scambier/obsidian-text-extractor) extracts the text of PDFs (and images) and caches it.
- [Omnisearch](https://github.com/scambier/obsidian-omnisearch) is a search engine for the vault. With Text Extractor installed, and PDF indexing turned on in Omnisearch's settings, its results include PDFs.

Install both from Community plugins and follow their own setup instructions; their settings and limits may change between versions. This page describes how they fit with Stacks. It hasn't been tested with any particular version of either plugin.

## From a PDF hit back to its reference

Stacks files each PDF in the attachments folder and links it from its reference note's `pdf` property (and `attachments` list). That link works in both directions:

1. Open the PDF from the search result.
2. Open the **Backlinks** pane (or the PDF's **Linked mentions**). The reference note is listed there, because its `pdf` property links to this file.
3. Open the reference note for the metadata, the citekey, your extracted highlights and your notes.

The attachment filename is the citekey by default (the **Attachment filename format** setting), so a PDF hit often tells you which reference it is before you open anything. Core search can also find the note from the PDF's name: search `[pdf:smith2020]`.

## Scanned PDFs

A PDF that is only page images, such as a scan without a text layer, has no text to extract, so no full-text search can find words in it. Stacks doesn't do OCR. Some options:

- Check whether Text Extractor can OCR such files in your version; it describes OCR for images.
- Add a text layer before filing the PDF, with your scanner's software or a tool such as OCRmyPDF.
- On desktop, the **Pre-extraction command** setting runs a command on a PDF before annotations are extracted. If that command writes a new PDF to `{out}`, the new file replaces the original. An OCR tool that adds a text layer can be run this way. Test it on a copy first.

Highlights you make on a scanned page still come through as page links (Stacks embeds the page when there is no text under the highlight), so you can find them in the note even without a text layer.
