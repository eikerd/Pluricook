/**
 * Regression suite for ingredient matching, driven by data/ingredients/expectations.json.
 *
 * Matching is a stack of heuristics plus a curated table, and both have the
 * property that fixing one food quietly breaks another. Every case in the
 * fixture is a real miss that was found by reading output — this is what stops
 * each one coming back.
 *
 * Add a case when a miss is noticed. Never delete one to make the suite pass.
 */

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { parseIngredientLine } from "./ingredient-parser";
import { readAliases } from "./ingredient-aliases";
import { toGrams } from "./to-grams";
import type { ExtractedRecipe } from "../types/provenance";

interface Case { line: string; expect: string; reject: string; found: string }
interface Rejection { line: string; found: string }
interface Fixture {
  cases: Case[];
  rejections: Rejection[];
  coverageFloor: { dish: string; minimumPercent: number; note: string };
}

const usdaReady = await Bun.file("usda.db").exists();
const suite = usdaReady ? describe : describe.skip;

const fixture: Fixture = await Bun.file("data/ingredients/expectations.json").json();
const db = usdaReady ? new Database("usda.db", { readonly: true }) : null;
const aliases = await readAliases();

/** Resolve a raw ingredient line exactly as the pipeline does. */
function resolve(line: string) {
  const parsed = parseIngredientLine(line);
  return toGrams({
    quantity: parsed.quantity,
    unit: parsed.unit,
    name: parsed.ingredientName,
    condition: parsed.preparation ?? null,
    db: db!,
    aliases,
  });
}

suite("ingredient matching — golden cases from the corpus", () => {
  for (const c of fixture.cases) {
    test(`${c.line}  →  ${c.expect}`, () => {
      const result = resolve(c.line);
      const matched = (result.foodDescription ?? "").toLowerCase();

      // A case that matches nothing is a failure: these lines all have a right answer.
      expect(matched, `nothing matched (basis: ${result.basis}) — ${c.found}`).not.toBe("");

      const alternatives = c.expect.split("|");
      expect(
        alternatives.some((a) => matched.includes(a.toLowerCase())),
        `got "${result.foodDescription}", wanted one of [${c.expect}] — ${c.found}`,
      ).toBe(true);

      if (c.reject) {
        expect(
          matched.includes(c.reject.toLowerCase()),
          `got the known-wrong answer "${result.foodDescription}" — ${c.found}`,
        ).toBe(false);
      }
    });
  }
});

suite("lines that must not be given a quantity", () => {
  for (const r of fixture.rejections) {
    test(r.line, () => {
      const result = resolve(r.line);
      // A confident wrong number is the failure mode the whole module guards
      // against, so "to taste" must produce nothing rather than something.
      expect(result.grams, `invented ${result.grams} g — ${r.found}`).toBeNull();
    });
  }
});

suite("coverage floor", () => {
  test(`${fixture.coverageFloor.dish} stays at or above ${fixture.coverageFloor.minimumPercent}%`, async () => {
    const path = `data/recipes/${fixture.coverageFloor.dish}.json`;
    if (!(await Bun.file(path).exists())) return;   // nothing captured yet

    const { recipes } = (await Bun.file(path).json()) as { recipes: ExtractedRecipe[] };
    let lines = 0;
    let converted = 0;

    for (const recipe of recipes) {
      for (const line of recipe.ingredientLines) {
        lines++;
        if (resolve(line).grams !== null) converted++;
      }
    }

    const percent = Math.round((converted / lines) * 100);
    expect(
      percent,
      `coverage is ${percent}% of ${lines} lines. ${fixture.coverageFloor.note}`,
    ).toBeGreaterThanOrEqual(fixture.coverageFloor.minimumPercent);
  });
});
