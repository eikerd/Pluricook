#!/usr/bin/env bun
/**
 * What the corpus agrees and disagrees about, for one dish.
 *
 *   bun scripts/compare-dish.ts meatloaf
 *   bun scripts/compare-dish.ts "lentil soup" --sources
 */

import { Database } from "bun:sqlite";
import { compareRecipes } from "../src/lib/compare";
import { ownersView } from "../src/lib/clones";
import { readAliases } from "../src/lib/ingredient-aliases";
import { readEquivalents } from "../src/lib/equivalents";
import type { ExtractedRecipe } from "../src/types/provenance";

const dish = process.argv[2] ?? "meatloaf";
const showSources = process.argv.includes("--sources");

const slug = dish.toLowerCase().replace(/\s+/g, "-");
const file = Bun.file(`data/recipes/${slug}.json`);
if (!(await file.exists())) {
  console.error(`No recipes at data/recipes/${slug}.json`);
  process.exit(1);
}

const { recipes: published } = (await file.json()) as { recipes: ExtractedRecipe[] };
// As the admin reads it — corrections applied, the owner's copies added — so the two cannot disagree.
const recipes = await ownersView(slug, published);
const db = new Database("usda.db", { readonly: true });
const cmp = compareRecipes({ recipes, db, aliases: await readAliases(), equivalents: await readEquivalents() });
const unit = cmp.anchor.unitLabel;

function table<T>(rows: T[], cols: Array<[string, (r: T) => string, boolean]>) {
  const header = cols.map(([h]) => h);
  const body = rows.map((r) => cols.map(([, get]) => get(r)));
  const w = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (cols[i]![2] ? c.padStart(w[i]!) : c.padEnd(w[i]!))).join("  ").trimEnd();
  console.log(line(header));
  console.log(w.map((n) => "─".repeat(n)).join("  "));
  for (const b of body) console.log(line(b));
}

console.log(`${dish} · ${cmp.analysed} recipes\n`);
console.log(`ANCHOR  ${unit}`);
console.log(`        ${cmp.anchor.reason}`);
console.log(`        present in ${cmp.withAnchor} of ${cmp.analysed} recipes\n`);

table(
  cmp.anchor.candidates.filter((c) => c.presence > 0),
  [
    ["Class", (c) => c.klass, false],
    ["Present in", (c) => `${Math.round(c.presence * 100)}%`, true],
    ["Median share", (c) => `${Math.round(c.medianShare * 100)}%`, true],
    ["Qualifies", (c) => (c.qualifies ? "yes" : "—"), false],
  ],
);

console.log(`\n\nCONSENSUS — in ${Math.round(cmp.commonThreshold * 100)}%+ of recipes\n`);
table(cmp.common, [
  ["Ingredient (USDA record)", (c) => c.foodDescription.slice(0, 42), false],
  ["In", (c) => `${c.recipeCount}/${cmp.analysed}`, true],
  [unit, (c) => (c.isAnchor ? "(anchor)" : String(c.medianRelative ?? "—")), true],
  ["Spread", (c) => (c.isAnchor ? "—" : c.spreadRelative ? `${c.spreadRelative}x` : "—"), true],
  ["g/serving", (c) => String(c.medianPerServing ?? "—"), true],
]);

console.log(`\n\nSALINITY — total sodium as salt-equivalent, ${unit}\n`);
table(cmp.recipes, [
  ["Source", (r) => r.siteName, false],
  ["Salt-eq g", (r) => String(r.saltEquivalentGrams), true],
  [unit, (r) => String(r.salinityRelative ?? "—"), true],
  ["mg Na/serving", (r) => (r.sodiumMgPerServing ?? "—").toLocaleString(), true],
  ["% daily", (r) => (r.sodiumDailyValueShare === null ? "—" : `${Math.round(r.sodiumDailyValueShare * 100)}%`), true],
  ["Resolved", (r) => `${r.resolvedLines}/${r.totalLines}`, true],
  ["Check", (r) => (r.salinityFlag === "ok" ? "" : r.salinityFlag.toUpperCase()), false],
]);
console.log(
  `\nCorpus median: ${cmp.medianSalinity ?? "—"} ${unit}. ` +
    `HIGH is over 2x the median, LOW under half, UNRELIABLE means too few lines resolved.` +
    `\nTotals are lower bounds: an unresolved line contributes no sodium.`,
);

console.log(`\n\nOUTLIERS — in 1–2 recipes only\n`);
table(cmp.outliers.slice(0, 14), [
  ["Ingredient (USDA record)", (c) => c.foodDescription.slice(0, 42), false],
  ["In", (c) => String(c.recipeCount), true],
  [unit, (c) => String(c.medianRelative ?? "—"), true],
  ["Who", (c) => c.sources.map((s) => s.siteName).join(", ").slice(0, 44), false],
]);

if (showSources) {
  console.log("\n\nWHO SITS WHERE\n");
  for (const c of cmp.common.filter((x) => !x.isAnchor).slice(0, 6)) {
    console.log(`${c.foodDescription} — median ${c.medianRelative} ${unit}`);
    for (const s of c.sources) {
      console.log(`  ${String(s.relative ?? "—").padStart(8)}  ${s.siteName.padEnd(24)} ${s.rawLine.slice(0, 44)}`);
    }
    console.log();
  }
}

console.log(
  `\n${cmp.common.length} consensus · ${cmp.outliers.length} outliers · ${cmp.unmatched.length} lines unmatched`,
);
