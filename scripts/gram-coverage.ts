#!/usr/bin/env bun
/**
 * How much of a dish's extracted recipes can we actually express in grams?
 *
 *   bun scripts/gram-coverage.ts meatloaf
 *   bun scripts/gram-coverage.ts meatloaf --lines    # every unconverted line
 *
 * Coverage is the gate on comparison: two recipes are only comparable to the
 * extent both sides converted, so this number bounds everything downstream.
 */

import { Database } from "bun:sqlite";
import { parseIngredientLine } from "../src/lib/ingredient-parser";
import { toGrams, type Basis } from "../src/lib/to-grams";
import type { ExtractedRecipe } from "../src/types/provenance";

const dish = process.argv[2] ?? "meatloaf";
const showLines = process.argv.includes("--lines");

const file = Bun.file(`data/recipes/${dish}.json`);
if (!(await file.exists())) {
  console.error(`No extracted recipes at data/recipes/${dish}.json — run extract-dish.ts first.`);
  process.exit(1);
}

const db = new Database("usda.db", { readonly: true });
const { recipes } = (await file.json()) as { recipes: ExtractedRecipe[] };

const byBasis = new Map<Basis, number>();
const unconverted: Array<{ site: string; line: string; basis: Basis; note: string | null }> = [];

type Row = { site: string; lines: number; converted: number; grams: number };
const rows: Row[] = [];

for (const recipe of recipes) {
  let converted = 0;
  let totalGrams = 0;

  for (const line of recipe.ingredientLines) {
    const parsed = parseIngredientLine(line);
    const result = toGrams({
      quantity: parsed.quantity,
      unit: parsed.unit,
      name: parsed.ingredientName,
      condition: parsed.preparation ?? null,
      db,
    });

    byBasis.set(result.basis, (byBasis.get(result.basis) ?? 0) + 1);

    if (result.grams !== null) {
      converted++;
      totalGrams += result.grams;
    } else {
      unconverted.push({
        site: recipe.provenance.siteName, line, basis: result.basis, note: result.note,
      });
    }
  }

  rows.push({
    site: recipe.provenance.siteName,
    lines: recipe.ingredientLines.length,
    converted,
    grams: Math.round(totalGrams),
  });
}

rows.sort((a, b) => b.converted / b.lines - a.converted / a.lines);

const COLS: Array<[string, (r: Row) => string, boolean]> = [
  ["Source", (r) => r.site, false],
  ["Lines", (r) => String(r.lines), true],
  ["In grams", (r) => String(r.converted), true],
  ["Coverage", (r) => `${Math.round((r.converted / r.lines) * 100)}%`, true],
  ["Total g", (r) => r.grams.toLocaleString(), true],
];

const header = COLS.map(([h]) => h);
const body = rows.map((r) => COLS.map(([, g]) => g(r)));
const w = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
const line = (cells: string[]) =>
  cells.map((c, i) => (COLS[i]![2] ? c.padStart(w[i]!) : c.padEnd(w[i]!))).join("  ").trimEnd();

console.log(line(header));
console.log(w.map((n) => "─".repeat(n)).join("  "));
for (const b of body) console.log(line(b));

const totalLines = rows.reduce((n, r) => n + r.lines, 0);
const totalConverted = rows.reduce((n, r) => n + r.converted, 0);
console.log(
  `\n${recipes.length} recipes · ${totalLines} ingredient lines · ` +
    `${totalConverted} in grams (${Math.round((totalConverted / totalLines) * 100)}%)`,
);

console.log("\nHow each line resolved:");
for (const [basis, n] of [...byBasis.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${basis.padEnd(22)} ${String(n).padStart(4)}  ${Math.round((n / totalLines) * 100)}%`);
}

if (showLines && unconverted.length > 0) {
  console.log(`\nUnconverted (${unconverted.length}):`);
  for (const u of unconverted) {
    console.log(`  [${u.basis}] ${u.site}: ${u.line}`);
    if (u.note) console.log(`      ${u.note}`);
  }
}
