// Bundles test/*.test.ts for node:test. Vault-level tests import an in-memory
// Obsidian stand-in (test/mocks/obsidian.ts) in place of the real "obsidian" module.
import esbuild from "esbuild";
import { readdirSync } from "node:fs";

const entries = readdirSync("test").filter((f) => f.endsWith(".test.ts")).map((f) => `test/${f}`);
await esbuild.build({
  entryPoints: entries,
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: "test-dist",
  outExtension: { ".js": ".mjs" },
  alias: { obsidian: "./test/mocks/obsidian.ts" },
  // Real npm packages used only by tests are loaded by Node, not bundled.
  external: ["yaml", "linkedom", "pdfjs-dist"],
  logLevel: "warning",
});
