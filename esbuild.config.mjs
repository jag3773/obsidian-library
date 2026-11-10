import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { xmlText } from "./scripts/esbuild-xml.mjs";

const prod = process.argv[2] === "production";

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  // Production builds are minified; licence comments from bundled code (citeproc-js) are kept at the end.
  minify: prod,
  legalComments: "eof",
  banner: {
    js: "/*! Stacks (MIT). Bundles citeproc-js (CPAL-1.0 or AGPL-3.0; used under CPAL) and a CSL style and locale (CC BY-SA 3.0). See NOTICE.md: https://github.com/jag3773/obsidian-stacks/blob/main/NOTICE.md */",
  },
  outfile: "main.js",
  // The bundled CSL style and locale (src/csl) are imported as compacted text.
  plugins: [xmlText],
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
