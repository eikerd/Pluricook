/**
 * Runs against the real usda.db, as compare.test.ts does: a line's grams and
 * food are only as right as the record it resolves to.
 */

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readAliases } from "./ingredient-aliases";
import { describeRecipe } from "./recipe-detail";
import type { ExtractedRecipe } from "../types/provenance";

const USDA = "usda.db";
const available = await Bun.file(USDA).exists();
const db = available ? new Database(USDA, { readonly: true }) : null;
const aliases = await readAliases();
const withDb = available ? describe : describe.skip;

type Section = { name: string; ingredientLines: string[] };

function recipe(lines: string[], sections?: Section[]): ExtractedRecipe {
  return {
    id: "test:fritters",
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
      host: "test.example",
      siteName: "Test Kitchen",
      sourceUrl: "https://test.example/fritters",
      author: "A. Cook",
      sourceTitle: "Apple Fritters",
      capturedAt: "2026-09-28",
      method: "structured-data",
      acquisitionAtCapture: "fetch",
      licence: null,
    },
  };
}

withDb("describeRecipe", () => {
  test("a recipe with sections is described section by section, lines in order", () => {
    const lines = ["360 g bread flour", "6 g salt", "300 g confectioners' sugar"];
    const d = describeRecipe(recipe(lines, [
      { name: "dough", ingredientLines: lines.slice(0, 2) },
      { name: "glaze", ingredientLines: lines.slice(2) },
    ]), db!, aliases);
    expect(d.sections.map((s) => s.name)).toEqual(["dough", "glaze"]);
    expect(d.sections[0]!.lines.map((l) => l.line)).toEqual(["360 g bread flour", "6 g salt"]);
  });

  test("a recipe without sections is one unnamed section", () => {
    const d = describeRecipe(recipe(["360 g bread flour", "6 g salt"]), db!, aliases);
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0]!.name).toBeNull();
    expect(d.sections[0]!.lines).toHaveLength(2);
  });

  test("a line comes to the grams it states (G11)", () => {
    const [line] = describeRecipe(recipe(["3 cups (360g) bread flour"]), db!, aliases).sections[0]!.lines;
    expect(line!.grams).toBe(360);
    expect(line!.food).toMatch(/flour/i);
  });

  test("a line the comparison cannot resolve has no grams and no food", () => {
    const [line] = describeRecipe(recipe(["Brown Butter (from above)"]), db!, aliases).sections[0]!.lines;
    expect(line).toMatchObject({ line: "Brown Butter (from above)", grams: null, share: null, food: null });
  });

  test("each counted line carries its share of the recipe's weight", () => {
    const d = describeRecipe(recipe(["300 g bread flour", "100 g water", "Brown Butter (from above)"]), db!, aliases);
    expect(d.totalGrams).toBe(400);
    expect(d.sections[0]!.lines.map((l) => l.share)).toEqual([75, 25, null]);
  });

  test("shares are of the whole recipe, across its sections", () => {
    const lines = ["300 g bread flour", "100 g water"];
    const d = describeRecipe(recipe(lines, [
      { name: "dough", ingredientLines: lines.slice(0, 1) },
      { name: "wash", ingredientLines: lines.slice(1) },
    ]), db!, aliases);
    expect(d.sections.map((s) => s.lines[0]!.share)).toEqual([75, 25]);
  });

  test("each line says how the parser read it", () => {
    const [line] = describeRecipe(recipe(["3 cups (360g) AP Flour"]), db!, aliases).sections[0]!.lines;
    expect(line!.read).toEqual({ quantity: 3, unit: "cups", name: "AP Flour", statedGrams: 360 });
  });

  test("a mass with no food identified is unresolved, as the comparison counts it", () => {
    // toGrams can do the arithmetic for "28 g", but the comparison drops a line
    // it cannot identify; the detail view must not show grams the charts lack.
    const [line] = describeRecipe(recipe(["28 g bourbon"]), db!, aliases).sections[0]!.lines;
    expect(line!.grams).toBeNull();
    expect(line!.food).toBeNull();
  });

  test("carries the credit and the link to the source", () => {
    const d = describeRecipe(recipe(["6 g salt"]), db!, aliases);
    expect(d).toMatchObject({
      recipeId: "test:fritters", siteName: "Test Kitchen", sourceTitle: "Apple Fritters",
      author: "A. Cook", sourceUrl: "https://test.example/fritters",
    });
  });
});
