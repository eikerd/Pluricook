#!/usr/bin/env bun
/**
 * Effective salinity of each recipe, as a percent of its meat weight.
 *
 *   bun scripts/salinity.ts meatloaf
 *
 * This is the charcuterie convention applied to home recipes. Sausage makers
 * specify salt as a percent of meat weight (1.5–2% is the usual band) because
 * it is the ratio that determines how the result tastes and binds — not the
 * batch size, and not anybody's idea of a serving.
 *
 * Table salt alone understates it: ketchup, Worcestershire, soy sauce and
 * seasoned crumbs all carry sodium. So total sodium is summed from the USDA
 * nutrient table across every resolved ingredient, then converted to its
 * salt equivalent (sodium × 2.54, the NaCl / Na mass ratio).
 */

import { Database } from "bun:sqlite";
import { parseIngredientLine } from "../src/lib/ingredient-parser";
import { readAliases } from "../src/lib/ingredient-aliases";
import { toGrams } from "../src/lib/to-grams";
import type { ExtractedRecipe } from "../src/types/provenance";

const NA_TO_NACL = 2.54;
const MEAT_CATEGORIES = new Set([5, 7, 10, 13, 15, 17]);

const dish = process.argv[2] ?? "meatloaf";
const { recipes } = (await Bun.file(`data/recipes/${dish}.json`).json()) as {
  recipes: ExtractedRecipe[];
};
const db = new Database("usda.db", { readonly: true });
const aliases = await readAliases();

const sodiumOf = db.query<{ amount: number | null }, [number]>(
  `SELECT fn.amount FROM food_nutrients fn JOIN nutrients n ON n.id = fn.nutrient_id
   WHERE fn.fdc_id = ?1 AND n.name = 'Sodium, Na' LIMIT 1`,
);
const categoryOf = db.query<{ category_id: number | null }, [number]>(
  `SELECT category_id FROM foods WHERE fdc_id = ?1`,
);

type Row = {
  site: string; servings: number | null; meat: number;
  tableSalt: number; saltEq: number; pctTable: number | null; pctTotal: number | null;
  resolved: number; lines: number;
};
const rows: Row[] = [];

for (const recipe of recipes) {
  let meat = 0, sodiumMg = 0, tableSalt = 0, resolved = 0;

  for (const line of recipe.ingredientLines) {
    const p = parseIngredientLine(line);
    const r = toGrams({
      quantity: p.quantity, unit: p.unit, name: p.ingredientName,
      condition: p.preparation ?? null, db, aliases,
    });
    if (r.grams === null || r.fdcId === null) continue;
    resolved++;

    const cat = categoryOf.get(r.fdcId)?.category_id ?? null;
    if (cat !== null && MEAT_CATEGORIES.has(cat)) meat += r.grams;
    if ((r.foodDescription ?? "").toLowerCase().startsWith("salt, table")) tableSalt += r.grams;

    // USDA nutrient amounts are per 100 g of the food.
    const na = sodiumOf.get(r.fdcId)?.amount ?? 0;
    sodiumMg += (na * r.grams) / 100;
  }

  const saltEq = (sodiumMg / 1000) * NA_TO_NACL;
  rows.push({
    site: recipe.provenance.siteName,
    servings: recipe.servings,
    meat: Math.round(meat),
    tableSalt: Math.round(tableSalt * 10) / 10,
    saltEq: Math.round(saltEq * 10) / 10,
    pctTable: meat > 0 ? Math.round((tableSalt / meat) * 1000) / 10 : null,
    pctTotal: meat > 0 ? Math.round((saltEq / meat) * 1000) / 10 : null,
    resolved, lines: recipe.ingredientLines.length,
  });
}

rows.sort((a, b) => (b.pctTotal ?? -1) - (a.pctTotal ?? -1));

const COLS: Array<[string, (r: Row) => string, boolean]> = [
  ["Source", (r) => r.site, false],
  ["Serves", (r) => String(r.servings ?? "—"), true],
  ["Meat g", (r) => r.meat.toLocaleString(), true],
  ["Table salt g", (r) => String(r.tableSalt), true],
  ["Salt-eq g", (r) => String(r.saltEq), true],
  ["Table % meat", (r) => (r.pctTable === null ? "—" : `${r.pctTable}%`), true],
  ["TOTAL % meat", (r) => (r.pctTotal === null ? "—" : `${r.pctTotal}%`), true],
  ["Resolved", (r) => `${r.resolved}/${r.lines}`, true],
];
const header = COLS.map(([h]) => h);
const body = rows.map((r) => COLS.map(([, g]) => g(r)));
const w = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
const line = (c: string[]) =>
  c.map((x, i) => (COLS[i]![2] ? x.padStart(w[i]!) : x.padEnd(w[i]!))).join("  ").trimEnd();
console.log(line(header));
console.log(w.map((n) => "─".repeat(n)).join("  "));
for (const b of body) console.log(line(b));

const spread = (vals: number[]) => {
  const v = vals.filter((x) => x > 0);
  return v.length > 1 ? (Math.max(...v) / Math.min(...v)).toFixed(1) : "—";
};
console.log(
  `\nSpread, table salt alone as % of meat:   ${spread(rows.map((r) => r.pctTable ?? 0))}x` +
    `\nSpread, TOTAL salt-equivalent % of meat: ${spread(rows.map((r) => r.pctTotal ?? 0))}x` +
    `\n\nCharcuterie reference band: 1.5–2.0% salt by meat weight.` +
    `\nUnresolved lines contribute no sodium, so totals are lower bounds.`,
);
