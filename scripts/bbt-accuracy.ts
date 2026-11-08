// Measures how often generateCitekey reproduces the keys in a Better BibTeX JSON export.
// Usage: npm run bbt-accuracy -- path/to/export.json [only-items-added-since, e.g. 2025]
import { generateCitekey } from "../src/citekey";
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(process.argv[2], "utf8"));
let ok = 0, n = 0; const miss: string[] = [];
const since = process.argv[3] || "0000";
for (const i of d.items) {
  if ((i.dateAdded||"") < since) continue;
  if (!i.citationKey) continue;
  const SEC = ["translator","contributor","reviewedAuthor","seriesEditor","bookAuthor","commenter"];
  const cr = (i.creators || []);
  let prim = cr.filter((c: any) => c.creatorType === "author");
  if (!prim.length) prim = cr.filter((c: any) => !SEC.includes(c.creatorType) && c.creatorType !== "editor");
  if (!prim.length) prim = cr.filter((c: any) => c.creatorType === "editor");
  const auth = prim.map((c: any) => c.lastName || c.name);
  const y = (i.date || "").match(/\d{4}/);
  const k = generateCitekey({ title: i.title, authors: auth, year: y ? y[0] : "" }, "auth.lower + shorttitle(3, 3) + year");
  n++;
  const base = i.citationKey.replace(/[a-z]$/, "");
  if (k === i.citationKey || k === base) ok++; else miss.push(`${i.citationKey}\t${k}\t${i.title}\t${JSON.stringify((i.creators||[]).map((c:any)=>c.creatorType+':'+(c.lastName||c.name)))}`);
}
console.log(`${ok}/${n} = ${(100*ok/n).toFixed(1)}%`);
console.log(miss.slice(0, 40).join("\n"));
