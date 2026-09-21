#!/usr/bin/env bun
/**
 * What the corpus agrees and disagrees about, for one dish.
 *
 *   bun scripts/compare-dish.ts meatloaf
 *   bun scripts/compare-dish.ts meatloaf --sources   # who sits where on each
 */

import { Database } from "bun:sqlite";
import { compareRecipes } from "../src/lib/compare";
import { readAliases } from "../src/lib/ingredient-aliases";
import type { ExtractedRecipe } from "../src/types/provenance";

const dish = process.argv[2] ?? "meatloaf";
const showSources = process.argv.includes("--sources");

const file = Bun.file(`data/recipes/${dish}.json`);
if (!(await file.exists())) {
  console.error(`No recipes at data/recipes/${dish}.json`);
  process.exit(1);
}

const { recipes } = (await file.json()) as { recipes: ExtractedRecipe[] };
const db = new Database("usda.db", { readonly: true });
const cmp = compareRecipes({ recipes, db, aliases: await readAliases() });

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

console.log(
  `${dish} · ${cmp.analysed} recipes analysed` +
    (cmp.skippedNoServings ? ` · ${cmp.skippedNoServings} skipped (no servings)` : ""),
);

console.log(`\n\nCONSENSUS — in ${Math.round(cmp.commonThreshold * 100)}%+ of recipes\n`);
table(cmp.common, [
  ["Ingredient (USDA record)", (c) => c.foodDescription.slice(0, 44), false],
  ["In", (c) => `${c.recipeCount}/${cmp.analysed}`, true],
  ["g/serving", (c) => String(c.medianPerServing ?? "—"), true],
  ["Low", (c) => String(Math.min(...c.sources.map((s) => s.gramsPerServing!))), true],
  ["High", (c) => String(Math.max(...c.sources.map((s) => s.gramsPerServing!))), true],
  ["Spread", (c) => (c.spread ? `${c.spread}x` : "—"), true],
]);

console.log(`\n\nOUTLIERS — in ${1}–2 recipes only\n`);
table(cmp.outliers.slice(0, 18), [
  ["Ingredient (USDA record)", (c) => c.foodDescription.slice(0, 44), false],
  ["In", (c) => String(c.recipeCount), true],
  ["g/serving", (c) => String(c.medianPerServing ?? "—"), true],
  ["Who", (c) => c.sources.map((s) => s.siteName).join(", ").slice(0, 46), false],
]);

if (showSources) {
  console.log("\n\nWHO SITS WHERE, on the most-agreed ingredients\n");
  for (const c of cmp.common.slice(0, 6)) {
    console.log(`${c.foodDescription}  — median ${c.medianPerServing} g/serving`);
    for (const s of c.sources) {
      console.log(
        `  ${String(s.gramsPerServing).padStart(7)} g  ${s.siteName.padEnd(24)} ${s.rawLine.slice(0, 46)}`,
      );
    }
    console.log();
  }
}

console.log(
  `\n${cmp.common.length} consensus ingredients · ${cmp.outliers.length} outliers · ` +
    `${cmp.unmatched.length} lines unmatched`,
);
