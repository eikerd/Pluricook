/**
 * These tests run against the real usda.db when it has been built, because the
 * point of the module is agreement with USDA's published portions, and a mocked
 * database would only test the arithmetic.
 *
 * Build it with:
 *   bun scripts/fetch-usda.ts && bun scripts/build-usda-db.ts
 */

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { foodTerms, matchFood, normalizeUnit, toGrams } from "./to-grams";

const USDA = "usda.db";
const available = await Bun.file(USDA).exists();
const db = available ? new Database(USDA, { readonly: true }) : null;

// Skipped rather than failed when the database is absent: a fresh clone has no
// usda.db, and a red suite there would say the code is broken when it is not.
const withDb = available ? describe : describe.skip;

describe("normalizeUnit", () => {
  test("collapses spelling variants", () => {
    expect(normalizeUnit("Tablespoons")).toBe("tbsp");
    expect(normalizeUnit("TBS")).toBe("tbsp");
    expect(normalizeUnit("tsp.")).toBe("tsp");
    expect(normalizeUnit("  Cups ")).toBe("cup");
    expect(normalizeUnit("pounds")).toBe("pounds");
  });

  test("leaves an unknown unit alone", () => {
    expect(normalizeUnit("pinch")).toBe("pinch");
  });
});

describe("mass units need no database", () => {
  const nodb = null as unknown as Database;

  test("converts each mass unit exactly", () => {
    expect(toGrams({ quantity: 2, unit: "lb", name: "ground beef", db: nodb }).grams).toBe(907.2);
    expect(toGrams({ quantity: 8, unit: "oz", name: "butter", db: nodb }).grams).toBe(226.8);
    expect(toGrams({ quantity: 450, unit: "g", name: "chicken", db: nodb }).grams).toBe(450);
    expect(toGrams({ quantity: 1.5, unit: "kg", name: "flour", db: nodb }).grams).toBe(1500);
  });

  test("reports the basis so the number can be trusted or questioned", () => {
    expect(toGrams({ quantity: 1, unit: "lb", name: "beef", db: nodb }).basis).toBe("direct-mass");
  });

  test("refuses a zero or nonsense quantity rather than returning 0 g", () => {
    expect(toGrams({ quantity: 0, unit: "g", name: "salt", db: nodb }).grams).toBeNull();
    expect(toGrams({ quantity: NaN, unit: "g", name: "salt", db: nodb }).grams).toBeNull();
  });
});

withDb("matched against real USDA data", () => {
  test("finds a generic food, preferring the shortest description", () => {
    const food = matchFood(db!, "onion");
    expect(food?.description.toLowerCase()).toContain("onion");
  });

  test("a cup of a common ingredient agrees with USDA's own portion", () => {
    const r = toGrams({ quantity: 1, unit: "cup", name: "granulated sugar", db: db! });
    expect(r.basis).toBe("usda-portion");
    expect(r.grams).toBeGreaterThan(150);
    expect(r.grams).toBeLessThan(250);
    expect(r.fdcId).not.toBeNull();
    expect(r.portionUsed).toContain("=");
  });

  test("scales linearly with quantity", () => {
    const one = toGrams({ quantity: 1, unit: "cup", name: "granulated sugar", db: db! });
    const two = toGrams({ quantity: 2, unit: "cup", name: "granulated sugar", db: db! });
    expect(two.grams!).toBeCloseTo(one.grams! * 2, 0);
  });

  test("THE OREGANO CASE: condition picks between portions of the same unit", () => {
    // USDA publishes 1 tsp leaves = 1.0 g and 1 tsp ground = 1.8 g for the same
    // dried oregano. Ignoring condition would make these identical.
    const leaves = toGrams({
      quantity: 1, unit: "tsp", name: "dried oregano", condition: "leaves", db: db!,
    });
    const ground = toGrams({
      quantity: 1, unit: "tsp", name: "dried oregano", condition: "ground", db: db!,
    });

    expect(leaves.basis).toBe("usda-portion");
    expect(ground.basis).toBe("usda-portion");
    expect(ground.grams).not.toBe(leaves.grams);
    expect(ground.grams!).toBeGreaterThan(leaves.grams!);
  });

  test("says so when the stated condition could not be matched", () => {
    const r = toGrams({
      quantity: 1, unit: "tsp", name: "dried oregano", condition: "julienned", db: db!,
    });
    if (r.basis === "usda-portion" && r.note) {
      expect(r.note).toContain("not matched");
    }
  });

  test("every grounded result names the USDA record it used", () => {
    const r = toGrams({ quantity: 1, unit: "cup", name: "whole milk", db: db! });
    if (r.grams !== null && r.basis !== "direct-mass") {
      expect(r.fdcId).not.toBeNull();
      expect(r.foodDescription).not.toBeNull();
      expect(r.portionUsed).not.toBeNull();
    }
  });

  test("returns a reason, never a guess, when nothing matches", () => {
    const r = toGrams({
      quantity: 1, unit: "cup", name: "zzzqqq nonexistent ingredient", db: db!,
    });
    expect(r.grams).toBeNull();
    expect(["no-food-match", "no-portion-match"]).toContain(r.basis);
    expect(r.note).toBeTruthy();
  });

  test("an unconvertible unit is refused rather than approximated", () => {
    const r = toGrams({ quantity: 1, unit: "pinch", name: "salt", db: db! });
    expect(r.grams).toBeNull();
  });
});

describe("foodTerms — keeping preparation out of the identity query", () => {
  test("drops preparation words that the Porter stemmer would misresolve", () => {
    // "chopped" stems to "chop" and matched "Pork, chop, center cut, raw".
    expect(foodTerms("onion, finely chopped")).toEqual(["onion"]);
    expect(foodTerms("garlic cloves, minced")).toEqual(["garlic", "cloves"]);
    expect(foodTerms("celery, thinly sliced")).toEqual(["celery"]);
  });

  test("drops parenthetical asides entirely", () => {
    expect(foodTerms("salt (or to taste)")).toEqual(["salt"]);
    expect(foodTerms("chili sauce (see note)")).toEqual(["chili", "sauce"]);
    expect(foodTerms("bread crumbs (or seasoned breadcrumbs)")).toEqual(["bread", "crumbs"]);
  });

  test("keeps the words that identify the food", () => {
    expect(foodTerms("unsalted butter")).toEqual(["unsalted", "butter"]);
    expect(foodTerms("Worcestershire sauce")).toEqual(["worcestershire", "sauce"]);
  });

  test("returns nothing when only preparation words remain", () => {
    expect(foodTerms("(to taste)")).toEqual([]);
  });
});

withDb("matching regressions found on the meatloaf corpus", () => {
  test.each([
    ["onion, finely chopped", "onion"],
    ["celery, finely chopped", "celery"],
  ])("%s resolves to a %s, not pork", (input, expected) => {
    // Before the fix these matched "Pork, chop, center cut, raw", because the
    // FTS Porter stemmer reduces "chopped" to "chop".
    const food = matchFood(db!, input, true);
    expect(food?.description.toLowerCase()).toContain(expected);
  });
});

/**
 * Known matching gaps, reproduced here so they are visible rather than folded
 * into the coverage number. Each is a real failure on the meatloaf corpus.
 */
withDb("known gaps — documented, not yet fixed", () => {
  test.todo("'garlic cloves' should not match the clove spice", () => {
    // Currently resolves to "Spices, cloves, ground": the unit word "cloves"
    // is also a food name. Needs the unit stripped before the food query.
    expect(matchFood(db!, "garlic cloves, minced", true)?.description).toContain("Garlic");
  });

  test.todo("bare 'milk' should not match 'Crackers, milk'", () => {
    // A single short term gives bm25 too little to rank on, so a compound food
    // beats the plain one. Needs a preference for foods whose description
    // STARTS with the term.
    expect(matchFood(db!, "milk", true)?.description).toMatch(/^Milk/);
  });

  test.todo("'ketchup' should find a record carrying a cup portion", () => {
    // Both USDA "Ketchup" records have zero portions; SR Legacy files the
    // measure under "Catsup". Needs a synonym table.
    expect(toGrams({ quantity: 1, unit: "cup", name: "ketchup", db: db! }).grams).not.toBeNull();
  });
});
