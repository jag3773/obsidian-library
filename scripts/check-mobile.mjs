// Checks that nothing desktop-only can load on Obsidian mobile, where there is no Node or
// Electron (#30). Run after `npm run build` with `npm run check:mobile`. Fails when:
//   1. the bundle imports any module but "obsidian" (Node built-ins and electron are external
//      in esbuild.config.mjs, so a static import of one would survive into main.js);
//   2. code outside src/desktop.ts reaches Node through window.require / activeWindow.require
//      (desktop.ts calls it only when Platform.isDesktopApp);
//   3. plugin source uses Node globals (Buffer, process, __dirname, __filename, global).
import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { xmlText } from "./esbuild-xml.mjs";

const problems = [];

// 1. Imports that survive bundling.
const result = await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  write: false,
  metafile: true,
  format: "cjs",
  target: "es2020",
  outfile: "check-mobile.js",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  plugins: [xmlText],
  logLevel: "silent",
});
for (const [file, input] of Object.entries(result.metafile.inputs)) {
  for (const imp of input.imports) {
    // Relative paths listed as external are type-only imports, which esbuild drops.
    if (imp.external && imp.path !== "obsidian" && !imp.path.startsWith(".")) problems.push(`${file} imports "${imp.path}", which mobile doesn't have`);
  }
}

// 2 and 3. Source scan of the plugin's own code.
const DESKTOP_ONLY = "src/desktop.ts";
const NODE_REQUIRE = /\b(?:window|activeWindow|globalThis)\s*\.\s*require\s*\(/;
const NODE_GLOBALS = /(?<![.\w])(?:Buffer\s*[.(]|process\s*\.|__dirname\b|__filename\b|global\s*\.)/;

function* tsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* tsFiles(path);
    else if (path.endsWith(".ts") && !path.endsWith(".d.ts")) yield path;
  }
}
for (const path of tsFiles("src")) {
  const file = relative(".", path).split("\\").join("/");
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      if (file !== DESKTOP_ONLY && NODE_REQUIRE.test(code)) problems.push(`${file}:${i + 1} calls Node's require outside ${DESKTOP_ONLY}`);
      if (file !== DESKTOP_ONLY && NODE_GLOBALS.test(code)) problems.push(`${file}:${i + 1} uses a Node global, which mobile doesn't have`);
    });
}

if (problems.length) {
  console.error(`Mobile check failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("Mobile check passed: the bundle imports only obsidian, and Node is reached only from src/desktop.ts.");
