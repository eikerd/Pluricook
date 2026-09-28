#!/usr/bin/env bun
/**
 * What should be added to data/ingredients/aliases.json next.
 *
 *   bun scripts/alias-worklist.ts            # every captured dish
 *   bun scripts/alias-worklist.ts --top 40
 *
 * Ranks ingredient phrases that failed to reach grams by how often they occur
 * across ALL dishes, because an alias for "olive oil" lifts every future dish
 * while one for "gelatin" lifts one recipe. For each phrase it also proposes
 * USDA candidates that carry household portions — an alias pointing at a
 * record with no portions cannot convert a cup of anything.
 */

import { Database } from "bun:sqlite";
import { Glob } from "bun";
import { conversionInput, parseLine } from "../src/lib/ingredient-line";
import { readAliases } from "../src/lib/ingredient-aliases";
import { ownersView } from "../src/lib/clones";
import { foodTerms, toGrams } from "../src/lib/to-grams";
import type { ExtractedRecipe } from "../src/types/provenance";

const top = Number(process.argv[process.argv.indexOf("--top") + 1]) || 25;
const db = new Database("usda.db", { readonly: true });
const aliases = await readAliases();

const misses = new Map<string, { count: number; dishes: Set<string>; example: string; basis: string }>();
let lines = 0, converted = 0;

for await (const path of new Glob("data/recipes/*.json").scan(".")) {
  const { dish, recipes: published } = (await Bun.file(path).json()) as { dish: string; recipes: ExtractedRecipe[] };
  // A line the owner has already corrected is not a miss to chase.
  const slug = path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
  const recipes = await ownersView(slug, published);
  for (const recipe of recipes) {
    for (const line of recipe.ingredientLines) {
      lines++;
      const p = parseLine(line);
      const r = toGrams({
        ...conversionInput(p), name: p.name,
        condition: p.preparation, db, aliases,
      });
      if (r.grams !== null) { converted++; continue; }
      if (r.basis === "rejected-by-alias") continue;   // deliberately not a food

      const key = foodTerms(p.name).join(" ") || p.name.toLowerCase().trim();
      if (!key) continue;
      const entry = misses.get(key) ?? { count: 0, dishes: new Set<string>(), example: line, basis: r.basis };
      entry.count++;
      entry.dishes.add(dish);
      misses.set(key, entry);
    }
  }
}

const candidates = db.query<{ fdc_id: number; description: string; n: number }, [string]>(`
  SELECT fdc_id, description, n FROM (
    SELECT f.fdc_id, f.description, bm25(foods_fts) AS rank,
           (SELECT COUNT(*) FROM portions p WHERE p.fdc_id = f.fdc_id) AS n
    FROM foods_fts JOIN foods f ON f.fdc_id = foods_fts.rowid
    WHERE foods_fts MATCH ?1 AND f.dataset = 'sr-legacy'
    ORDER BY rank LIMIT 60
  ) WHERE n > 0 ORDER BY rank, length(description) LIMIT 3`);

console.log(`${lines} lines across all dishes · ${converted} in grams (${Math.round((converted / lines) * 100)}%)\n`);
console.log(`Top ${top} unconverted phrases, most frequent first:\n`);

const ranked = [...misses.entries()].sort((a, b) => b[1].count - a[1].count || b[1].dishes.size - a[1].dishes.size);
for (const [phrase, m] of ranked.slice(0, top)) {
  console.log(`${String(m.count).padStart(3)}x  ${phrase.padEnd(26)} [${m.basis}]  dishes: ${[...m.dishes].join(", ")}`);
  console.log(`      e.g. ${m.example.slice(0, 70)}`);
  const terms = phrase.split(/\s+/).filter((t) => t.length > 2);
  if (terms.length > 0) {
    try {
      for (const c of candidates.all(terms.map((t) => `"${t}"`).join(" "))) {
        console.log(`        ${String(c.fdc_id).padStart(7)}  ${c.description.slice(0, 58)}  (${c.n} portions)`);
      }
    } catch { /* an FTS syntax edge; the phrase still shows */ }
  }
}
