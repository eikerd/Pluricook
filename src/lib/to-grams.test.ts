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
import { buildAliasTable, type AliasTable } from "./ingredient-aliases";
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
    expect(toGrams({ quantity: 2, unit: "lb", name: "ground beef", db: nodb }).grams).toBe(907.18);
    expect(toGrams({ quantity: 8, unit: "oz", name: "butter", db: nodb }).grams).toBe(226.8);
    expect(toGrams({ quantity: 450, unit: "g", name: "chicken", db: nodb }).grams).toBe(450);
    expect(toGrams({ quantity: 1.5, unit: "kg", name: "flour", db: nodb }).grams).toBe(1500);
  });

  // G17: a tenth of a gram is a fifth of a quarter-gram of nutmeg.
  test.each([
    [0.75, "whole cumin seeds"],
    [0.25, "nutmeg"],
    [0.3, "ground allspice"],
  ])("G17: %p g of %s stays exact", (quantity, name) => {
    expect(toGrams({ quantity, unit: "g", name, db: nodb }).grams).toBe(quantity);
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
withDb("marry me chicken, 2026-10-24", () => {
  // Raw, boneless, skinless breast: SR Legacy weighs one as "1 piece = 272 g".
  const BREAST = 171077;
  const HEAVY_CREAM = 170859;

  test("G29: a counted chicken breast weighs USDA's one piece", () => {
    const r = toGrams({ quantity: 4, unit: "each", name: "chicken breast", db: db!, aliases: pinned(BREAST, "chicken breast") });
    expect(r.grams).toBe(1088);
    expect(r.portionUsed).toContain("piece");
  });

  test("G30: a cup of heavy cream is poured, not whipped", () => {
    const aliases = pinned(HEAVY_CREAM, "heavy cream");
    expect(toGrams({ quantity: 0.5, unit: "cup", name: "heavy cream", db: db!, aliases }).grams).toBe(119);
    expect(toGrams({ quantity: 150, unit: "ml", name: "heavy cream", db: db!, aliases }).grams).toBeCloseTo(151, 0);
  });

  test("G36: a counted leaf finds USDA's portion written in the plural", () => {
    const r = toGrams({ quantity: 12, unit: "leaf", name: "basil", db: db!, aliases: pinned(172232, "basil") });
    expect(r.grams).toBe(6);
  });

  test("G30: a recipe that says whipped still gets the whipped cup", () => {
    const aliases = pinned(HEAVY_CREAM, "heavy cream");
    expect(toGrams({ quantity: 1, unit: "cup", name: "heavy cream, whipped", db: db!, aliases }).grams).toBe(120);
  });
});

/** An alias table holding one pattern, so a test does not depend on aliases.json. */
function pinned(fdcId: number, phrase: string): AliasTable {
  return buildAliasTable({ exact: {}, patterns: { [phrase]: { fdcId, note: "test" } }, reject: [] });
}

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
