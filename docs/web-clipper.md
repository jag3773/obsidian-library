# Capturing from the web with Obsidian Web Clipper

[Obsidian Web Clipper](https://obsidian.md/clipper) is the main way to bring a web page into Stacks. The clipper runs in your browser, so it can read pages that turn away the plugin's own request: sites behind a bot check, a sign-in, or a cookie banner. Stacks then completes the note from the clipper's properties and its own lookup, and files it in your library.

The handoff is simple: Web Clipper saves a note into your **inbox folder** (Settings → Folders), and Stacks processes it as it arrives (or when you run **Process inbox now**).

## Properties Stacks reads from a clip

| Property | Required | What Stacks does with it |
|---|---|---|
| `url` or `source` | Yes | The page to look up. Without it, the note stays in the inbox. Stacks reads every name listed under **URL properties in clipped notes** (default `url, source`). The property the clip came with is kept, so clipping the same page again is recognized as a duplicate. |
| `title` | Recommended | Used when the lookup fails, or when the page has no title of its own. |
| `author` | Recommended | A list, `[[links]]` (aliases are fine), or one plain name. Used when the lookup finds no authors. |
| `published` | Recommended | Publication date, in any common format. Used when the lookup finds no date. |
| `description` | Recommended | Used as the abstract when the lookup finds none, or when the lookup's abstract was cut short ("…") and the description is longer. |
| `doi` | Optional | A DOI read from the page. When the page's own lookup finds no DOI (for example because the site blocked it), Stacks looks the DOI up in Crossref instead. |

Stacks also accepts these values under your own mapped property names (Settings → Library base → Fields), and `date`, `authors`, `creator`, `abstract` and `summary` as alternatives.

The clip's body is never changed. Stacks writes properties only, then renames the note and moves it into your references folder.

## What happens to a clip

1. Stacks reads the URL and looks the page up, the same way **Add reference** does: site readers, schema.org data, COinS, then the standard citation tags. A page that names a DOI is completed from Crossref; a PubMed page from NCBI's E-utilities.
2. If the clip carries a DOI and the page lookup found none, the DOI is looked up instead.
3. Where the lookup has no value, the clip's own title, author, published date and description fill in. If every lookup fails, the clip's values are used on their own, and the note is still filed.
4. Values the lookup found replace the clipper's guesses (such as a page title with the site's name in it), unless you edited them while the lookup ran. Your URL and status are kept.
5. The note gets a citekey, the **Status for web clips**, and its configured filename, and moves into the references folder.

A note whose URL (or DOI or ISBN) is already in the library stays in the inbox, with a notice naming the existing note.

## A Web Clipper template for Stacks

Import this in Web Clipper (Settings → Templates → Import), then change `path` to your inbox folder if it isn't `Inbox`.

```json
{
  "schemaVersion": "0.1.0",
  "name": "Stacks reference",
  "behavior": "create",
  "noteNameFormat": "{{title}}",
  "path": "Inbox",
  "noteContentFormat": "{{content}}",
  "properties": [
    { "name": "title", "value": "{{title}}", "type": "text" },
    { "name": "source", "value": "{{url}}", "type": "text" },
    { "name": "author", "value": "{{author|split:\", \"|wikilink|join}}", "type": "multitext" },
    { "name": "published", "value": "{{published}}", "type": "date" },
    { "name": "description", "value": "{{description}}", "type": "text" },
    { "name": "doi", "value": "{{meta:name:citation_doi}}", "type": "text" },
    { "name": "created", "value": "{{date}}", "type": "date" },
    { "name": "tags", "value": "clippings", "type": "multitext" }
  ],
  "triggers": []
}
```

Notes on the template:

- It matches Web Clipper's default template, plus a `doi` property read from the page's `citation_doi` tag (most journal sites have one). An empty `doi` is ignored.
- Stacks writes its own `authors` and `abstract` properties beside the clipper's `author` and `description`. To keep a single property, map **Authors** to `author` and **Abstract** to `description` in Settings → Library base → Fields, or rename the properties in the template.
- `created` and `tags` are not used by Stacks and are kept as they are.
- Variable and filter names follow Web Clipper's documentation at the time of writing. If an import fails in your Web Clipper version, create the template by hand with the same property names.

## Scholarly sites

- **Journal pages** usually carry Highwire `citation_*` tags with a DOI, so the work is completed from Crossref.
- **PubMed** records (`pubmed.ncbi.nlm.nih.gov/12345678/`) are read from NCBI's E-utilities summary, then from Crossref when the record names a DOI. You can also paste `PMID: 12345678` into **Add reference**, and a PMID in a PDF's opening pages is found when the PDF has no DOI or ISBN.
- **Library catalogs and repositories** that publish COinS (`<span class="Z3988">`) are read when the page has exactly one COinS span and its title matches the page. Pages that list COinS for the works they cite (such as encyclopedia articles) are not mistaken for those works.

## Not supported yet

- Capturing several results at once from a search or listing page. Clip each result, or paste its DOI into **Add reference**.

Everything a page or service returns is treated as untrusted: it is written into properties, and anything that reaches the note body is escaped so it can't add links, images, HTML or code.
