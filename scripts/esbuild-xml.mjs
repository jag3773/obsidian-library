// Loads the bundled CSL style and locale (src/csl) as text, with comments and the indentation
// between elements removed. Whitespace inside an element's text is kept: only runs that
// contain a line break and sit between two tags are dropped, so a term such as
// <term name="x"> </term> keeps its space.
import { readFile } from "node:fs/promises";

export function compactXml(xml) {
  return xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s*\n\s*</g, "><")
    .trim();
}

export const xmlText = {
  name: "xml-text",
  setup(build) {
    build.onLoad({ filter: /\.(csl|xml)$/ }, async (args) => ({
      contents: compactXml(await readFile(args.path, "utf8")),
      loader: "text",
    }));
  },
};
