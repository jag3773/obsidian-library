# Library health and duplicates

A library grows by many small captures, imports and renames. Stacks can check it for the problems that quietly break citations and links, and merge references that turned out to be the same work. Checking only reads your notes. Every repair is a separate command that shows you what it will change first.

## Check library health

Run **Stacks: Check library health**. Stacks reads every note in your references folder and writes a report note, `Stacks health check`, beside the references folder (at the vault root when the references folder is `References`). Each problem links to the note or file it is about, so you can click through and fix it.

The report is rewritten each time the check runs, so don't keep your own notes in it. Apart from that one note, the check changes nothing.

| Check | What it finds |
|---|---|
| Frontmatter that doesn't parse | Notes whose YAML is broken. Obsidian shows them without properties, so Stacks can't read their citekey, type or status. Open the note in source mode and fix the YAML. |
| No citekey | Notes that can't be cited or exported. **Complete current reference** gives one a citekey. |
| Citekeys used by more than one note | Compared without regard to case, as Stacks does when it picks a new key. A citation can only point at one of them. |
| Filename doesn't match the citekey | The filename the citekey gives under your **Note filename format** setting, compared with the real one. A note named `smith2020 1` because `smith2020` was taken shows up here. |
| `pdf` links that don't resolve | The note's `pdf` property points at a file that isn't there. When a PDF named after the citekey exists (preferring one in the attachments folder), the report names it and the relink command below can fix the link. |
| PDFs in the attachments folder with no note | No reference note links to them, in its properties or its text. When one is named after the citekey of a note that has no `pdf`, the report says so. |
| Possible duplicates | Groups of notes with the same DOI, ISBN or URL, or the same title and year. See [Duplicates](#duplicates). |
| In one status for more than N days | Notes in a watched status that haven't changed in longer than the setting allows. See below. |
| No type | Notes without a `type`, or with a type Stacks doesn't know (exported as a generic document). See [citation fields](citation-fields.md#types). |
| Missing citation fields | What a citation of the note's type needs and the note lacks, using the same rules as the bibliography export. See [what each type needs](citation-fields.md#what-each-type-needs). |

### How "in one status" is measured

Obsidian doesn't record when a property changed, so Stacks can't know the day a note's status was set. It counts from the note's last modification, or its `added` date if that is later. Changing the status modifies the note, so the real time in that status is at least this long: the check can miss a stuck item (one you edited for another reason), but it never reports one too early. Sync tools or a git checkout that reset modification times make items look newer, not older.

Two settings, under **Health check**, control it:

- **Report items in one status for more than**: days, default 365. 0 turns the check off.
- **Statuses to watch**: default `queued, reading, reviewing`, the statuses that mean work is still ahead. Leave it empty to watch every status.

## Relink PDFs named after citekeys

Run **Stacks: Relink PDFs named after citekeys**. It runs the same check and lists each note it can fix:

- a note whose `pdf` link doesn't resolve, where exactly one PDF named after its citekey exists (the attachments folder wins when there is one there and one elsewhere);
- a note with no `pdf`, where an unlinked PDF in the attachments folder is named after its citekey.

"Named after its citekey" means `citekey.pdf`, or the name your **Attachment filename format** gives. Each line shows the current value and the PDF it will point to, with a toggle. Choose **Relink** to write the ticked ones: the `pdf` property gets a link to the PDF, and the `attachments` list gets the same link in place of the broken one. Note bodies aren't touched. A note whose `pdf` changed after the preview is skipped.

## Duplicates

Stacks finds duplicates by exact matches only:

- the same DOI (with or without `https://doi.org/`, in any case);
- the same ISBN, with ISBN-10 and ISBN-13 forms treated as one;
- the same URL, in the `url` property or any of your **URL properties in clipped notes** (scheme and host in any case, trailing slash ignored);
- the same title and year, ignoring case, accents, punctuation and spacing. Both must be present: two notes with the same title and no year are not matched.

There is no fuzzy matching, and nothing is ever merged automatically. Each match shows why it matched.

### Review and merge

Run **Stacks: Review duplicate references** to see every group, or open one of the notes and run **Stacks: Merge duplicates of current reference**. Choose **Review** on a group to see the merge preview.

The note kept is the one whose filename is its own citekey. When none or several are, you choose. For each other note, the preview shows:

- how many links, in how many notes, will point to the kept note instead;
- each property that will be filled or extended;
- whether its annotations or prose are copied;
- that it moves to the trash.

Choose **Merge** to do it. For each other note, Stacks:

1. Combines list properties (`collections`, `attachments`, `tags`, `aliases`), adding the items the kept note lacks.
2. Fills every property the kept note leaves empty, such as a publisher or a `pdf`. Nothing the kept note already has is replaced, and its citekey never changes.
3. Copies the other note's annotations block when the kept note's is missing or empty. Every other paragraph the kept note doesn't already have (your own notes, or highlights that differ) goes at the end, under `## Merged from <name>`, with the section heading it sat under. That section is outside the annotation markers, so re-extracting never removes it.
4. Rewrites every link to the other note, in any note in the vault, to point to the kept note: wikilinks and Markdown links, embeds, links to headings and blocks, and links in properties. The alias or link text is kept. Links inside code are left alone.
5. Moves the other note to the trash, following your **Deleted files** setting in Obsidian.

PDFs aren't moved or deleted: the kept note now lists the other note's attachments.

Not changed:

- Pandoc citations such as `[@smith2020a]` in your drafts. The preview names the citekey that goes away; search for it and replace it with the kept note's.
- Links in canvases and in files other than Markdown notes.
- Block IDs. A link to a block in the other note (`#^id`) points to the kept note afterwards, but only finds the block if that paragraph was copied over with its ID.

## Recovering from a repair

Stacks keeps no journal or undo for these repairs. A merged note is in the trash, and you can restore it from there. For everything else, rely on what already protects your vault: Obsidian's File recovery core plugin, a backup, or git. If your vault is in git, commit before a large clean-up, and `git diff` afterwards shows exactly what changed.
