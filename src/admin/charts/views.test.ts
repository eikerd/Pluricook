import { describe, expect, test } from "bun:test";
import type { VisualMatrix } from "../../lib/visual-matrix";
import { pickDistinct, rowLabels } from "./views";

describe("pickDistinct", () => {
  test("choosing a value another slot holds swaps them, so no slot repeats", () => {
    expect(pickDistinct([0, 1, 2], 0, 2)).toEqual([2, 1, 0]);
  });
  test("a fresh value simply replaces", () => {
    expect(pickDistinct([0, 1, 2], 1, 5)).toEqual([0, 5, 2]);
  });
});

describe("rowLabels", () => {
  test("two recipes that read alike get distinct row labels", () => {
    const recipe = (siteName: string) => ({ recipeId: siteName + Math.random(), siteName, unknownLines: 0, anchorGrams: 1, salinity: null, salinityFlag: "ok" });
    const m = { recipes: [recipe("Serious Eats"), recipe("Serious Eats"), recipe("Delish")] } as unknown as VisualMatrix;
    expect(rowLabels(m)).toEqual(["Serious Eats (1)", "Serious Eats (2)", "Delish"]);
  });
});
