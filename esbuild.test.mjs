// Bundles test/*.test.ts (which import only pure modules) for node:test.
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
  logLevel: "warning",
});
