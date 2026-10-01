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
  // The owner, 2026-09-30: "initially by mass from left to right … not by the
  // order that it appears in the recipe". Mass across every recipe drawn.
  test("ingredients run from the most mass to the least, left to right", () => {
    const s = stackComposition(pizzas);
    expect(s.segments.map((x) => x.label)).toEqual(["flour", "water", "cheese", "salt"]);
  });

  test("past the coloured ones, everything folds into Other, itemized per recipe", () => {
    const s = stackComposition(pizzas, { colored: 2 });
    expect(s.segments.map((x) => x.label)).toEqual(["flour", "water"]);
    expect(s.hasOther).toBe(true);
    const b = s.bars.find((c) => c.recipe === 1)!;
    expect(b.other).toBe(348);
    expect(b.otherItems).toEqual([{ label: "cheese", grams: 340 }, { label: "salt", grams: 8 }]);
  });

  test("a recipe's total is everything it lists, coloured or not", () => {
    const b = stackComposition(pizzas, { colored: 2 }).bars.find((c) => c.recipe === 1)!;
    expect(b.total).toBe(998);
    expect(b.grams).toEqual([400, 250]);
  });

  test("bars run from the largest share of the most shared ingredient down", () => {
    // Flour's share: a 300/506, b 400/998, c 350/567.
    expect(stackComposition(pizzas).bars.map((c) => c.recipe)).toEqual([2, 0, 1]);
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
    const empty = stackComposition(m).bars.find((c) => c.recipe === 1)!;
    expect(empty.total).toBe(0);
    expect(empty.grams).toEqual([0]);
  });
});

/** Meatloaves: a matrix whose recipes carry their meat, the anchor, in grams. */
function loaves(anchorGrams: Array<number | null>, ingredients: Array<{ label: string; anchor?: boolean; grams: Array<number | null> }>): VisualMatrix {
  const m = matrix(anchorGrams.map((_, i) => `loaf ${i}`), ingredients);
  return {
    ...m,
    normalization: { kind: "class", anchorClass: "meat", reason: "" },
    recipes: m.recipes.map((r, i) => ({ ...r, anchorGrams: anchorGrams[i] })),
    ingredients: m.ingredients.map((x, j) => ({ ...x, isAnchor: Boolean(ingredients[j]!.anchor), klass: ingredients[j]!.anchor ? "meat" : "vegetable" })),
  } as VisualMatrix;
}

describe("stackComposition per a fixed weight of the primary ingredient", () => {
  // A two-pound loaf and a half-pound loaf, the same recipe at two sizes.
  const m = loaves([900, 225, null], [
    { label: "beef", anchor: true, grams: [900, 225, null] },
    { label: "catsup", grams: [120, 30, 50] },
    { label: "egg", grams: [100, null, 50] },
  ]);
  const s = stackComposition(m, { perAnchor: 450 });

  test("every recipe is scaled to the same weight of meat, so one recipe at two sizes draws one bar", () => {
    const big = s.bars.find((b) => b.recipe === 0)!;
    const small = s.bars.find((b) => b.recipe === 1)!;
    expect(big.grams).toEqual([60, 50]);
    expect(small.grams).toEqual([60, 0]);
  });

  test("the meat itself is not a segment: it is the same 450 g in every bar", () => {
    expect(s.segments.map((x) => x.label)).toEqual(["catsup", "egg"]);
    expect(s.bars.find((b) => b.recipe === 0)!.total).toBe(110);
  });

  test("a recipe with no meat weighed cannot be scaled, and is named rather than dropped silently", () => {
    expect(s.bars.map((b) => b.recipe)).not.toContain(2);
    expect(s.unscaled).toEqual([2]);
  });

  test("bars run from the most of the first ingredient per 450 g down", () => {
    const m2 = loaves([450, 450], [{ label: "catsup", grams: [10, 90] }]);
    expect(stackComposition(m2, { perAnchor: 450 }).bars.map((b) => b.recipe)).toEqual([1, 0]);
  });

  test("with no primary ingredient there is nothing to scale to, and every recipe is unscaled", () => {
    const clr = { ...m, normalization: { kind: "clr", anchorClass: null, reason: "" } } as VisualMatrix;
    const none = stackComposition(clr, { perAnchor: 450 });
    expect(none.bars).toEqual([]);
    expect(none.unscaled).toEqual([0, 1, 2]);
  });
});

describe("stackComposition sorted by one ingredient", () => {
  // salt, cheese, water, flour; default order flour, water, cheese, salt.
  test("bars run from the most of that ingredient down, and it moves to the left edge", () => {
    const s = stackComposition(pizzas, { sortBy: { ingredient: 0, dir: "desc" } });   // salt: 6, 8, 7
    expect(s.bars.map((b) => b.recipe)).toEqual([1, 2, 0]);
    expect(s.segments.map((x) => x.label)).toEqual(["salt", "flour", "water", "cheese"]);
    expect(s.bars.find((b) => b.recipe === 1)!.grams).toEqual([8, 400, 250, 340]);
  });

  test("each ingredient keeps its colour wherever it moves", () => {
    const before = stackComposition(pizzas).segments;
    const after = stackComposition(pizzas, { sortBy: { ingredient: 0, dir: "desc" } }).segments;
    const colour = (segs: typeof before) => Object.fromEntries(segs.map((x) => [x.label, x.color]));
    expect(colour(after)).toEqual(colour(before));
  });

  test("ascending runs the other way, a recipe without it counting as none", () => {
    const s = stackComposition(pizzas, { sortBy: { ingredient: 1, dir: "asc" } });   // cheese only in b
    expect(s.bars.at(-1)!.recipe).toBe(1);
  });

  test("Other sorts by its total and stays at the right end", () => {
    const s = stackComposition(pizzas, { colored: 2, sortBy: { ingredient: -1, dir: "desc" } });
    expect(s.bars[0]!.recipe).toBe(1);   // cheese and salt: 348
    expect(s.segments.map((x) => x.label)).toEqual(["flour", "water"]);
  });
});
