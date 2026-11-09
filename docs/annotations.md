# Highlights, comments and the reading round trip

Stacks turns the highlights and comments in a reference's PDF into Markdown in the reference note. Each item links back to its page. You can read in Obsidian's PDF viewer, in [PDF++](https://github.com/RyotaUshio/obsidian-pdf-plus), or in a reading app on a tablet; Stacks does not include a reader of its own.

## Extract annotations

Open a reference note (or its PDF) and run **Stacks: Extract annotations for current note**.

Stacks reads the PDF linked in the note's `pdf` property (or the first PDF in `attachments`) and writes the annotations under the **Annotations heading** (default `## Annotations`). If the note has no such heading, Stacks adds one at the end of the note.

```markdown
## Annotations

<!-- stacks:annotations:start -->
### Page 12

> [!quote] Quote · [[smith2020.pdf#page=12|p. 12]]
> The highlighted passage, as plain text.
>
> > [!note] Comment
> > The comment you typed on the highlight.

^ann-1x9k2f

<!-- stacks:annotations:end -->
```

- **Only the text between the two markers belongs to Stacks.** Each extraction replaces that block, so highlights you deleted in the PDF disappear and new ones appear. Your writing elsewhere in the note, including under the same heading but outside the markers, is never changed. Edits made inside the markers are lost on the next extraction, so write your thoughts outside them.
- **Each item has a block ID** (`^ann-…`) that is derived from its page and position, so it stays the same across extractions and when a reading app re-saves the file. Link to one highlight from anywhere with `[[smith2020#^ann-1x9k2f]]`.
- **Page links survive renames.** They are ordinary wikilinks, so Obsidian updates them when the PDF is renamed or moved.
- **Page labels** from the PDF are used in the headings and links' display text (`Page iv`), while the link itself points at the physical page.
- The note's `highlights` property gets the number of items, and `last_highlighted` gets the date whenever the annotations change. Running the command again with nothing new writes nothing.
- **Status after extraction** (optional) moves the note's status forward, for example from `reviewing` to `processed`. It never moves a note backwards in your status list.

### What is extracted

| In the PDF | In the note |
| --- | --- |
| Highlight, underline, strikeout, squiggly | A callout chosen by color, with the text under the annotation |
| A comment on one of those, and replies to it | A nested `[!note] Comment` callout |
| Sticky note, text box | A `note` callout (see `note:` in the color map) |
| Rectangle (an "image" area in some readers) | An embed of the page |
| Ink drawings, shapes, stamps | Skipped and counted in the notice |

Most PDFs don't store the highlighted text, only where the highlight sits. Stacks reads the words underneath, so highlights that start or stop mid-word are rounded to whole words, and a word broken across lines by a hyphen is joined again.

**Scanned pages** have no text to read. Highlights there are kept as an embed of the page (`![[file.pdf#page=N]]`), and the notice names the pages. Stacks doesn't do OCR; the pre-extraction command (below) is the place to plug one in.

**Password-protected PDFs** can't be read until the password is removed; the notice says so.

### Highlight colors

**Settings → Highlight colors** maps each color to a callout type and a label, one line per color:

```text
yellow: quote, Quote
red: important, Important
green: tip, Follow up
blue: example, Image
default: quote, Highlight
note: note, Note
```

Colors can be `yellow`, `red`, `green`, `blue`, `orange`, `purple`, `magenta`, `cyan`, `gray`, or a hex value like `#ff6666`. Each reader's shade of a color is matched to its name by hue, so different apps' yellows all count as yellow. `default` covers colors without a line; `note` is used for sticky notes and text boxes. Any [callout type](https://help.obsidian.md/callouts) works, including custom ones from a CSS snippet.

### Re-extract when you save in Obsidian

Turn on **Extract when a PDF is saved** to re-extract whenever a PDF in the attachments folder changes, for example after you highlight in PDF++ and it writes the annotations into the file.

### Pre-extraction command (desktop)

Some reading apps highlight just the words you dragged over when you meant the whole sentence or paragraph. A **pre-extraction command** runs on the PDF before extraction, so a script can fix that (or run OCR, or anything else that edits the PDF). It runs from the vault folder, with `{in}` and `{out}` replaced by file paths:

```text
python3 scripts/expand_highlights.py {in} {out}
```

If the command writes `{out}`, that file replaces the PDF; if it edits `{in}` in place, the edited file is used. If the command fails, the notice shows its output and extraction uses the PDF unchanged. The command runs for **Extract annotations** and for PDFs that come back from the tablet, but not for extract-on-save, so a script that rewrites the file can't start a loop.

### Kindle and other sources

Kindle highlights aren't in a PDF. Use a Kindle highlights plugin and embed its note in the reference note, for example with a line like `![[Kindle/{{citekey}}]]` in your note template.

## Reading round trip with a tablet (desktop)

If you read on a tablet whose reading app syncs a folder (Dropbox, iCloud Drive, Google Drive, Syncthing…), Stacks can send PDFs there and bring them back with your highlights.

Set up under **Settings → Reading round trip**:

| Setting | Default | What it does |
| --- | --- | --- |
| Tablet folder | empty (off) | The folder on this computer that your reading app syncs. An absolute path. |
| Send on status | `reading` | Changing a note's status to this copies its PDF to the tablet folder. Empty: only the command sends. |
| Status when highlights return | `reviewing` | Set when a PDF comes back changed. Empty: unchanged. |
| Bring back PDFs Stacks didn't send | off | Also import PDFs already in the folder that have the same name as an attachment and are newer than it. |

### How it works

1. **Send.** Set the status to `reading`, or run **Stacks: Send PDF to tablet folder**. The PDF is copied under its attachment name (for example `smith2020.pdf`). Stacks records a fingerprint (SHA-256) of the file as sent. It never overwrites a copy in the folder that has changes it hasn't brought back.
2. **Read and highlight** on the tablet. The app saves your highlights into the PDF and syncs it back to the folder.
3. **Return.** While Obsidian runs, Stacks watches the folder, and it checks the whole folder each time Obsidian starts. **Stacks: Check tablet folder for returned PDFs** checks on demand. When a PDF's fingerprint differs from what was sent, Stacks waits until the sync client has finished writing it, runs the pre-extraction command if you set one, copies it over the attachment in the vault, sets the status to `reviewing`, and extracts the annotations into the note.
4. **Review** in Obsidian's viewer or PDF++. With **Extract when a PDF is saved** on, changes you make there update the note too.

Returned PDFs are matched by file name, and the fingerprint tells a real change from a re-sync of the same file. Stacks also follows the attachment when you rename it in Obsidian. If it was renamed while Obsidian was closed, Stacks finds it through the note's `pdf` link or by its content.

### When both copies changed

If the PDF changed in the vault (for example, you highlighted in PDF++) **and** on the tablet since it was sent, Stacks shows both copies side by side: when each was modified, its size, and how many annotations it has. Choose:

- **Use tablet copy**: the tablet copy becomes the note's PDF and is extracted; the vault copy is saved next to it as `smith2020 (vault copy 2026-11-09).pdf`.
- **Keep vault copy**: the vault copy stays; the tablet copy is saved next to it as `smith2020 (tablet copy 2026-11-09).pdf`.
- **Decide later**: nothing changes, and you're asked again at the next check.

Either way both versions are kept, and the saved copy is linked from the note's `attachments`.

### Mobile

The round trip and the pre-extraction command need the desktop app, which can reach folders outside the vault and run commands. On mobile these settings are hidden and the commands don't appear. Extraction itself works on mobile.

### Without a tablet

None of this is needed to read in Obsidian. Read the PDF in Obsidian's viewer or PDF++, highlight there (PDF++ can write highlights into the file), and run **Extract annotations** or turn on **Extract when a PDF is saved**.
