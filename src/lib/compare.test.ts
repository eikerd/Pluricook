/**
 * Runs against the real usda.db, for the reason to-grams.test.ts gives: the
 * comparison is only as right as the food it resolves each line to, and a
 * mocked database would test the arithmetic alone.
 *
 * Every recipe here is synthetic and stated in grams, so each expected figure
 * can be worked out by hand from the lines above it.
 */

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { compareRecipes, type Comparison } from "./compare";
import { readAliases } from "./ingredient-aliases";
import type { ExtractedRecipe } from "../types/provenance";

const USDA = "usda.db";
const available = await Bun.file(USDA).exists();
const db = available ? new Database(USDA, { readonly: true }) : null;
const aliases = await readAliases();
const withDb = available ? describe : describe.skip;

type Section = { name: string; ingredientLines: string[] };

function recipe(siteName: string, lines: string[], sections?: Section[]): ExtractedRecipe {
  return {
    id: `test:${siteName}`,
    dish: "test-dish",
    ingredientLines: lines,
    sections,
    stepCount: 1,
    servings: null,
    servingsRaw: null,
    totalTimeMinutes: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    totalTimeRaw: null,
    provenance: {
      host: `${siteName}.example`,
      siteName,
      sourceUrl: `https://${siteName}.example/recipe`,
      author: null,
      sourceTitle: siteName,
      capturedAt: "2026-09-20",
      method: "structured-data",
      acquisitionAtCapture: "fetch",
      licence: null,
    },
  };
}

/** The anchor class, or null when the dish fell through to centred log-ratio. */
const anchorClass = (c: Comparison) => (c.anchor.kind === "class" ? c.anchor.klass : null);

/** The salt cluster, asserted present — so a matching regression fails, rather than crashing on undefined. */
function saltOf(c: Comparison) {
  const salt = c.common.find((x) => /^salt/i.test(x.foodDescription));
  expect(salt, "no salt cluster among the common ingredients").toBeDefined();
  return salt!;
}

const compare = (recipes: ExtractedRecipe[], section?: string | null) =>
  compareRecipes({ recipes, db: db!, aliases, section });

withDb("anchor normalization", () => {
  test("a meat dish reports every ingredient against the meat", () => {
    const c = compare([
      recipe("a", ["1000 g ground beef", "20 g salt"]),
      recipe("b", ["500 g ground beef", "10 g salt"]),
      recipe("c", ["2000 g ground beef", "40 g salt"]),
    ]);

    expect(anchorClass(c)).toBe("meat");
    expect(c.withAnchor).toBe(3);

    // Three batch sizes, one ratio: the whole reason to anchor rather than
    // compare raw grams. 20/1000 = 10/500 = 40/2000 = 2%.
    const salt = saltOf(c);
    expect(salt.medianRelative).toBe(2);
    expect(salt.spreadRelative).toBe(1);
  });

  test("a recipe naming one food twice has the amounts summed, not listed twice", () => {
    const c = compare([
      recipe("a", ["1000 g ground beef", "10 g salt", "10 g salt"]),
      recipe("b", ["1000 g ground beef", "20 g salt"]),
    ]);

    const salt = saltOf(c);
    expect(salt.recipeCount).toBe(2);
    expect(salt.sources.map((s) => s.grams).sort()).toEqual([20, 20]);
  });
});

withDb("salinity", () => {
  test("flags a recipe at more than twice the corpus median as high", () => {
    const c = compare([
      recipe("a", ["1000 g ground beef", "18 g salt"]),
      recipe("b", ["1000 g ground beef", "20 g salt"]),
      recipe("c", ["1000 g ground beef", "22 g salt"]),
      recipe("salty", ["1000 g ground beef", "60 g salt"]),
    ]);

    const flags = Object.fromEntries(c.recipes.map((r) => [r.siteName, r.salinityFlag]));
    expect(flags).toEqual({ a: "ok", b: "ok", c: "ok", salty: "high" });
  });

  test("counts sodium that arrives in other ingredients, not table salt alone", () => {
    const plain = compare([recipe("a", ["1000 g ground beef", "10 g salt"])]);
    const withSoy = compare([recipe("a", ["1000 g ground beef", "10 g salt", "60 g soy sauce"])]);

    expect(withSoy.recipes[0]!.saltEquivalentGrams).toBeGreaterThan(
      plain.recipes[0]!.saltEquivalentGrams + 5,
    );
  });
});

withDb("sections", () => {
  const DOUGH = ["500 g bread flour", "350 g water", "10 g salt"];
  const SAUCE = ["400 g tomatoes", "4 g salt"];

  const sectioned = (name: string, dough: string[], sauce?: string[]) =>
    recipe(name, [...dough, ...(sauce ?? [])], [
      { name: "dough", ingredientLines: dough },
      ...(sauce ? [{ name: "sauce", ingredientLines: sauce }] : []),
    ]);

  const pizzas = [
    sectioned("a", DOUGH, SAUCE),
    sectioned("b", DOUGH, SAUCE),
    sectioned("dough-only", DOUGH),
  ];

  test("lists the sections on offer, in first-seen order", () => {
    expect(compare(pizzas).sectionsAvailable).toEqual(["dough", "sauce"]);
  });

  test("whole-recipe salt mixes dough and sauce; the dough section does not", () => {
    const whole = compare(pizzas);
    const dough = compare(pizzas, "dough");

    // The dough's own figure is the baker's percentage: 10 / 500 = 2%.
    const doughSalt = saltOf(dough);
    expect(anchorClass(dough)).toBe("grain");
    expect(doughSalt.medianRelative).toBe(2);

    // Whole-recipe salt for a and b is (10 + 4) / 500 = 2.8% — a number that
    // describes neither the dough nor the sauce.
    const wholeSalt = saltOf(whole);
    expect(wholeSalt.medianRelative).toBe(2.8);
  });

  test("each section chooses its own anchor from its own lines", () => {
    const sauce = compare(pizzas, "sauce");
    expect(anchorClass(sauce)).toBe("vegetable");

    const salt = saltOf(sauce);
    expect(salt.medianRelative).toBe(1);   // 4 / 400
  });

  test("a recipe without the section takes no part", () => {
    const sauce = compare(pizzas, "sauce");
    expect(sauce.analysed).toBe(2);
    expect(sauce.recipes.map((r) => r.siteName).sort()).toEqual(["a", "b"]);
  });

  test("line counts describe the section, not the whole recipe", () => {
    const sauce = compare(pizzas, "sauce");
    expect(sauce.recipes.every((r) => r.totalLines === 2)).toBe(true);
  });

  test("an unknown section compares nothing rather than falling back to everything", () => {
    const c = compare(pizzas, "frosting");
    expect(c.analysed).toBe(0);
    expect(c.common).toEqual([]);
  });
});
