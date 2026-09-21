import { describe, expect, test } from "bun:test";
import { mergeRecipes } from "./recipe-merge";
import type { ExtractedRecipe } from "../types/provenance";

function recipe(
  url: string,
  method: ExtractedRecipe["provenance"]["method"] = "structured-data",
  lines = ["1 lb beef"],
): ExtractedRecipe {
  return {
    id: url, dish: "meatloaf", ingredientLines: lines,
    servings: 8, servingsRaw: "8", totalTimeMinutes: 60, totalTimeRaw: "PT1H",
    prepTimeMinutes: null, cookTimeMinutes: null, stepCount: 5,
    provenance: {
      host: "example.com", siteName: "Example", sourceUrl: url, author: null,
      sourceTitle: "Meatloaf", capturedAt: "2026-09-20", method,
      acquisitionAtCapture: "fetch", licence: null,
    },
  };
}

describe("mergeRecipes — a refresh must never shrink the corpus by accident", () => {
  test("a hand-entered recipe survives a refresh that does not mention it", () => {
    // The bug: re-running extract-dish wrote only that run's output, deleting
    // the Serious Eats recipe the owner had typed in by hand.
    const manual = recipe("https://www.seriouseats.com/meatloaf", "manual-transcription");
    const result = mergeRecipes([manual], [recipe("https://natashaskitchen.com/meatloaf/")]);

    expect(result.recipes).toHaveLength(2);
    expect(result.recipes.some((r) => r.provenance.method === "manual-transcription")).toBe(true);
    expect(result.keptManual).toBe(1);
    expect(result.added).toBe(1);
  });

  test("a recipe whose site is unreachable today is kept, not dropped", () => {
    const held = recipe("https://www.budgetbytes.com/meatloaf/");
    const result = mergeRecipes([held], []);   // this run fetched nothing
    expect(result.recipes).toHaveLength(1);
    expect(result.kept).toBe(1);
  });

  test("a successful re-extraction replaces the held copy", () => {
    const old = recipe("https://delish.com/meatloaf", "structured-data", ["1 lb beef"]);
    const fresh = recipe("https://delish.com/meatloaf", "structured-data", ["2 lb beef", "1 egg"]);
    const result = mergeRecipes([old], [fresh]);

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0]!.ingredientLines).toEqual(["2 lb beef", "1 egg"]);
    expect(result.refreshed).toBe(1);
  });

  test("a fetch never overwrites what a person typed in", () => {
    const manual = recipe("https://www.seriouseats.com/meatloaf", "manual-transcription", ["typed by hand"]);
    const fetched = recipe("https://www.seriouseats.com/meatloaf", "structured-data", ["from the page"]);
    const result = mergeRecipes([manual], [fetched]);

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0]!.ingredientLines).toEqual(["typed by hand"]);
  });

  test("two spellings of one page are one recipe", () => {
    const result = mergeRecipes([], [
      recipe("https://www.delish.com/meatloaf/"),
      recipe("https://delish.com/meatloaf?utm_source=x"),
    ]);
    expect(result.recipes).toHaveLength(1);
    expect(result.added).toBe(1);
  });

  test("an empty corpus plus a run is just the run", () => {
    const result = mergeRecipes([], [recipe("https://a.com/x"), recipe("https://b.com/y")]);
    expect(result.recipes).toHaveLength(2);
    expect(result.added).toBe(2);
    expect(result.kept).toBe(0);
  });
});
