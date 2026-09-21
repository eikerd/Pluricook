import { describe, expect, test } from "bun:test";
import { aitchison, buildMatrix, diffCell, jaccardDistance, uniqueLabels } from "./visual-matrix";
import type { Comparison, IngredientCluster } from "./compare";

/** A Comparison with only what buildMatrix reads: three recipes, b = a doubled, c = a plus basil. */
function comparison(): Comparison {
  const cluster = (fdcId: number, name: string, amounts: Record<string, number>): IngredientCluster => ({
    fdcId, foodDescription: name, klass: fdcId === 1 ? "grain" : "unanchorable", isAnchor: fdcId === 1,
    recipeCount: Object.keys(amounts).length, frequency: 1, medianGrams: 0, medianRelative: null,
    spreadRelative: null, medianPerServing: null,
    sources: Object.entries(amounts).map(([recipeId, relative]) => ({
      recipeId, siteName: recipeId, sourceUrl: null, rawLine: `${relative} of ${name}`,
      grams: relative * (recipeId === "b" ? 2 : 1), relative, gramsPerServing: null, basis: "direct-mass",
    })),
  } as IngredientCluster);
  const recipe = (recipeId: string) => ({
    recipeId, siteName: recipeId, sourceUrl: null, servings: null, resolvedLines: 3, totalLines: 3,
    anchorGrams: recipeId === "b" ? 200 : 100, sodiumMg: 0, saltEquivalentGrams: 0, salinityRelative: null,
    sodiumMgPerServing: null, sodiumDailyValueShare: null, salinityFlag: "ok" as const,
  });
  return {
    dish: "t", section: null, sectionsAvailable: [], analysed: 3, withAnchor: 3, commonThreshold: 0.5,
    anchor: { kind: "class", klass: "grain", via: "priority", unitLabel: "% of grain", reason: "r", candidates: [] },
    common: [cluster(1, "flour", { a: 100, b: 100, c: 100 }), cluster(2, "water", { a: 70, b: 70, c: 70 }),
             cluster(3, "salt", { a: 2, b: 2, c: 2 })],
    occasional: [],
    outliers: [cluster(4, "basil", { c: 5 })],
    recipes: [recipe("a"), recipe("b"), recipe("c")], medianSalinity: null,
    unmatched: [{ recipeId: "a", siteName: "a", rawLine: "a pinch of something", basis: "no-food-match" }],
  };
}

describe("buildMatrix — acceptance cases", () => {
  const m = buildMatrix(comparison());

  test("a recipe doubled: grams differ, every scale-free comparison does not", () => {
    expect(m.grams[1]![0]).toBe(2 * m.grams[0]![0]!);
    expect(m.values[1]).toEqual(m.values[0]!);
    expect(m.sharedDistance[0]![1]).toBe(0);
    expect(m.fixedDistance[0]![1]).toBe(0);
    expect(m.membershipDistance[0]![1]).toBe(0);
  });

  test("one added ingredient moves membership, not the shared-ratio distance", () => {
    expect(m.membershipDistance[0]![2]).toBe(0.25);   // 3 of 4
    expect(m.sharedDistance[0]![2]).toBe(0);
    expect(m.sharedCount[0]![2]).toBe(3);
  });

  test("the fixed basis is what every recipe lists, so basil is outside it", () => {
    expect(m.fixedBasis.map((j) => m.ingredients[j]!.name)).toEqual(["flour", "water", "salt"]);
  });

  test("an unresolved line is counted as unknown and never becomes a zero", () => {
    expect(m.recipes[0]!.unknownLines).toBe(1);
    expect(m.values[0]![3]).toBeNull();
    expect(m.values.flat()).not.toContain(0);
  });

  test("carries the denominator and how it was chosen", () => {
    expect(m.normalization).toMatchObject({ kind: "class", anchorClass: "grain" });
    expect(m.recipes.map((r) => r.anchorGrams)).toEqual([100, 200, 100]);
  });
});

describe("diffCell", () => {
  test("a missing or zero baseline is 'added', never an infinite change", () => {
    expect(diffCell(5, null)).toEqual({ kind: "added" });
    expect(diffCell(5, 0)).toEqual({ kind: "added" });
  });
  test("removed, neither, and a doubling", () => {
    expect(diffCell(null, 5)).toEqual({ kind: "removed" });
    expect(diffCell(null, null)).toEqual({ kind: "neither" });
    expect(diffCell(4, 2)).toEqual({ kind: "same-basis", log2: 1 });
  });
});


describe("aitchison", () => {
  test("a recipe scaled up is the same recipe: distance 0", () => {
    expect(aitchison([100, 70, 2], [200, 140, 4])).toBe(0);
  });

  test("is symmetric", () => {
    const a = [100, 70, 2], b = [100, 60, 3];
    expect(aitchison(a, b)).toBe(aitchison(b, a)!);
  });

  test("compares only what both recipes list", () => {
    expect(aitchison([100, 70, null], [100, 70, 9])).toBe(0);
  });

  test("refuses when fewer than two ingredients are shared", () => {
    expect(aitchison([100, null], [null, 5])).toBeNull();
    expect(aitchison([100, null], [50, 5])).toBeNull();
  });
});

describe("jaccardDistance", () => {
  test("same ingredients at different amounts: 0", () => {
    expect(jaccardDistance([1, 2, null], [9, 9, null])).toBe(0);
  });

  test("nothing in common: 1", () => {
    expect(jaccardDistance([1, null], [null, 1])).toBe(1);
  });

  test("one of three shared", () => {
    expect(jaccardDistance([1, 1, null], [null, 1, 1])).toBe(0.667);
  });
});

describe("uniqueLabels", () => {
  test("two flours that shorten alike are told apart", () => {
    expect(uniqueLabels([
      "Wheat flour, white, bread, enriched",
      "Wheat flour, white, all-purpose, enriched, bleached",
      "Salt, table",
    ])).toEqual(["Wheat flour, white, bread", "Wheat flour, white, all-purpose", "Salt, table"]);
  });

  test("identical names are numbered rather than merged", () => {
    expect(uniqueLabels(["Basil, fresh", "Basil, fresh"])).toEqual(["Basil, fresh (1)", "Basil, fresh (2)"]);
  });
});
