# Collections, library views and batch edits

Bases already gives you saved views of your library: filters, sorts, groups and columns. Stacks adds two things on top: a ready-made library base for the reading workflow, and batch edits that change many reference notes at once.

## Collections are links

A reference's `collections` property (or whatever you mapped the **Collections** field to) is a list of links to topic or concept notes:

```yaml
collections:
  - "[[Climate adaptation]]"
  - "[[Thesis chapter 2]]"
```

- **A reference can sit in several collections** without being copied. There is one note per source, and each collection is a link from it.
- **Collection notes get backlinks for free.** Open `Climate adaptation` and its backlinks pane lists every reference in it. The collection note can hold your own synthesis, and a Base view with a filter on the collections property lists the members as a table.
- **The collection note doesn't have to exist.** An unresolved link still groups references. Create the note when you have something to say about the topic.
- **Bibliographies per collection** use the existing export filter: `collections: Climate adaptation` in the **Only references where** setting.

## The library base

Run **Stacks: Create library base** (or press **Create base** in the settings). Stacks writes `Library.base` (or `Library 1.base`, `Library 2.base`… if that name is taken; an existing file is never overwritten) using your references folder, your property names and your statuses. It has these views:

| View | Shows |
|---|---|
| Library | Every reference, grouped by status |
| One view per status | With the default statuses: Queued, Reading, Reviewing, Processed, Shelved. The reading workflow is queued → reading → reviewing → processed, with shelved for things you decided not to read now |
| Unfiled | References in no collection (`collections` is empty) |
| Missing PDF | References with no `pdf` link |

If no library base is set in the settings yet, the new file becomes the library base. Edit the views freely afterwards; Stacks only reads the base to learn your folder and property names.

## Batch edits

Batch edits change many reference notes at once:

- **Set status**
- **Add to collection** and **Remove from collection** (the link is matched by the note it resolves to, so `[[Climate]]` and `[[Topics/Climate|Climate]]` count as the same collection)
- **Regenerate citekeys** (notes named by their citekey are renamed, and links to them are updated)
- **Complete metadata** (each note with an ISBN, DOI or URL is looked up online, one at a time; only empty properties are filled, as with **Complete current reference**)

Every batch opens a preview first. It names the scope, counts the notes, lists the ones that will be processed and the ones left alone with the reason (already that status, not in the references folder, no identifier…). Nothing is written until you press **Apply**. Writes go through Obsidian's frontmatter API, one note at a time; note bodies are never touched. While a batch runs you see its progress and can press **Stop** (or close the dialog), which stops after the note in progress. At the end, any note that failed is listed with its error, and the rest of the batch still ran.

Setting a status that sends PDFs to the tablet folder (the **Send on status** setting, desktop) also sends each note's PDF, exactly as if you had changed the status by hand. The preview warns you when that will happen.

### What "scope" means

A batch acts on one of these sets of notes. The preview always names which one. Only notes in the references folder are changed; others in the scope are listed as left alone.

| Where you start | Scope |
|---|---|
| File explorer, several notes selected → right-click → **Batch edit N references** | Exactly the selected notes |
| File explorer, right-click a folder → **Batch edit references in this folder** | References in that folder and its subfolders |
| **Stacks: Batch edit references** from a note outside the references folder (a collection or project note) | Your choice of: references that link to that note (its backlinks, the members of a collection), references that note links to, or all references |
| **Stacks: Batch edit references** from a reference note | That one note, or all references |
| **Stacks: Batch edit references** with nothing open | All references |
| The **Batch edit…** button in a **Stacks batch** view in a Base | Exactly the rows that view shows |

### Acting on the rows of a Base

Obsidian doesn't let plugins read the rows of its built-in table or cards views, or which rows you selected there. So the commands above can't act on "the table you're looking at". Instead, Stacks adds a Bases view type, **Stacks batch** (Obsidian 1.10 or later). In a base, add a view, choose **Stacks batch** as its type, and give it the filters you want. Obsidian evaluates those filters itself, so the view lists exactly the notes the base selects, and its **Batch edit…** button opens the preview for those notes. A common setup is a table view and a Stacks batch view with the same filters side by side.

Stacks doesn't evaluate `.base` filter expressions on its own. The Bases expression language is rich enough that a partial re-implementation would sometimes act on the wrong notes.
