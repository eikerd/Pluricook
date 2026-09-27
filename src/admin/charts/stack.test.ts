import { describe, expect, test } from "bun:test";
import type { VisualMatrix } from "../../lib/visual-matrix";
import { stackComposition } from "./stack";

/** Just the fields the stacked view reads: recipes, ingredients, grams. */
function matrix(recipes: string[], ingredients: Array<{ label: string; grams: Array<number | null> }>): VisualMatrix {
  return {
    recipes: recipes.map((siteName) => ({ recipeId: siteName, siteName, unknownLines: 0, anchorGrams: null, salinity: null, salinityFlag: "ok" })),
    ingredients: ingredients.map((x) => ({
      fdcId: 0, name: x.label, label: x.label, klass: "grain", isAnchor: false,
      recipeCount: x.grams.filter((g) => g != null).length, median: null,
    })),
    grams: recipes.map((_, i) => ingredients.map((x) => x.grams[i] ?? null)),
  } as unknown as VisualMatrix;
}

// Three pizzas: flour, water and salt in all three; cheese in one.
const pizzas = matrix(["a", "b", "c"], [
  { label: "salt", grams: [6, 8, 7] },
  { label: "cheese", grams: [null, 340, null] },
  { label: "water", grams: [200, 250, 210] },
  { label: "flour", grams: [300, 400, 350] },
]);

describe("stackComposition", () => {
  test("the most shared ingredients come first, the heaviest first among equals", () => {
    const s = stackComposition(pizzas);
    expect(s.segments.map((x) => x.label)).toEqual(["flour", "water", "salt", "cheese"]);
    expect(s.segments.map((x) => x.recipeCount)).toEqual([3, 3, 3, 1]);
  });

  test("past the coloured ones, everything folds into Other, itemized per recipe", () => {
    const s = stackComposition(pizzas, 2);
    expect(s.segments.map((x) => x.label)).toEqual(["flour", "water"]);
    expect(s.hasOther).toBe(true);
    const b = s.columns.find((c) => c.recipe === 1)!;
    expect(b.other).toBe(348);
    expect(b.otherItems).toEqual([{ label: "cheese", grams: 340 }, { label: "salt", grams: 8 }]);
  });

  test("a recipe's total is everything it lists, coloured or not", () => {
    const b = stackComposition(pizzas, 2).columns.find((c) => c.recipe === 1)!;
    expect(b.total).toBe(998);
    expect(b.grams).toEqual([400, 250]);
  });

  test("columns run from the largest share of the most shared ingredient down", () => {
    // Flour's share: a 300/506, b 400/998, c 350/567.
    expect(stackComposition(pizzas).columns.map((c) => c.recipe)).toEqual([2, 0, 1]);
  });

  test("an ingredient no recipe weighs is not a segment", () => {
    const m = matrix(["a", "b"], [
      { label: "flour", grams: [100, 200] },
      { label: "salt, to taste", grams: [null, null] },
    ]);
    expect(stackComposition(m).segments.map((x) => x.label)).toEqual(["flour"]);
    expect(stackComposition(m).hasOther).toBe(false);
  });

  test("a recipe that lists nothing weighed totals zero rather than NaN", () => {
    const m = matrix(["a", "b"], [{ label: "flour", grams: [100, null] }]);
    const empty = stackComposition(m).columns.find((c) => c.recipe === 1)!;
    expect(empty.total).toBe(0);
    expect(empty.grams).toEqual([0]);
  });
});
