# Find PDF

**Find PDF for current reference** looks for a legal open-access copy of a reference's full text and, after you confirm the source, attaches it to the note. It only runs when you run the command; Stacks never fetches PDFs on its own.

## How it works

1. Open a reference note and run **Stacks: Find PDF for current reference**.
2. Stacks looks in two places:
   - **Unpaywall**, by the note's DOI. Unpaywall's API requires a contact email, so this uses the **Contact email** in Settings → Lookups (the same address sent to Crossref). With no email set, Unpaywall is skipped and the command says so.
   - **The landing page**: the DOI's page (through doi.org), or, for a note without a DOI, the page in its `url` property. Many publishers, repositories and arXiv name their PDF in a `citation_pdf_url` tag.
3. A dialog lists every copy found, with its source and, for Unpaywall, where it is hosted (publisher or repository), which version it is (published version, accepted manuscript, or submitted manuscript), and its license. Nothing is downloaded until you choose one.
4. Stacks downloads the copy you chose and checks that it really is a PDF: the server must not call it a web page or other text, and the file must start with the PDF signature (`%PDF-`). Sign-in pages, bot checks and error pages are rejected, and nothing is saved.
5. The PDF is saved in your attachments folder under the **Attachment filename format**, and linked from the note's `pdf` and `attachments` properties, exactly as a PDF filed from the inbox. An existing file is never replaced: if the name is taken, the new file gets a number (`citekey 1.pdf`).

A note that already has a `pdf` is left alone; remove the property first if you want another copy. If you attach a PDF while the download runs, the download is discarded.

## Limits

- Only open-access copies are found. Paywalled articles, most books, and works without a DOI or a landing page that names its PDF will usually have nothing to offer.
- An accepted or submitted manuscript can differ from the published version in wording and page numbers. The dialog shows the version so you can decide; cite the published version where you can.
- Some publishers serve the PDF only to browsers, or only after a cookie check. Those downloads are rejected as "not a PDF". Download the file in your browser instead.
- Unpaywall's data is a snapshot; a listed copy can move or disappear.

You can always attach your own copy: drop the PDF into your inbox (it is matched by its DOI or ISBN), or link it in the note's `pdf` property.

## Privacy

Find PDF sends the note's DOI and your contact email to Unpaywall (api.unpaywall.org), and requests the DOI's landing page (or the note's URL) and the chosen PDF from the sites that host them. Nothing else about your notes is sent.
