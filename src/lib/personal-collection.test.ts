import { describe, expect, test } from "bun:test";
import {
  cellToLine,
  decideVisibility,
  matrixToRecipes,
  parseCell,
  type CollectionFile,
} from "./personal-collection";
import { assertProvenance, internalRef, isPublishable } from "../types/provenance";

describe("parseCell — every shorthand in the owner's Detroit Pizza sheet", () => {
  test("a bare number is grams", () => {
    expect(parseCell(273)).toEqual({ kind: "grams", grams: 273, variant: null });
    expect(parseCell("4.1")).toEqual({ kind: "grams", grams: 4.1, variant: null });
  });

  test("an explicit g is still grams", () => {
    expect(parseCell("300g")).toEqual({ kind: "grams", grams: 300, variant: null });
    expect(parseCell("210 g")).toEqual({ kind: "grams", grams: 210, variant: null });
  });

  test("'AP 315' is grams of a substituted ingredient", () => {
    expect(parseCell("AP 315")).toEqual({ kind: "grams", grams: 315, variant: "ap" });
  });

  test("measured cells keep their unit", () => {
    expect(parseCell("1 Tb")).toEqual({ kind: "measured", quantity: "1", unit: "tb" });
    expect(parseCell("28 oz")).toEqual({ kind: "measured", quantity: "28", unit: "oz" });
    expect(parseCell("1 Cup")).toEqual({ kind: "measured", quantity: "1", unit: "cup" });
    expect(parseCell("30ml")).toEqual({ kind: "measured", quantity: "30", unit: "ml" });
    expect(parseCell("1/4 tsp")).toEqual({ kind: "measured", quantity: "1/4", unit: "tsp" });
    expect(parseCell("1.5 tsp")).toEqual({ kind: "measured", quantity: "1.5", unit: "tsp" });
  });

  test("a size word makes it a count", () => {
    expect(parseCell("3 med")).toEqual({ kind: "count", quantity: "3", size: "medium" });
  });

  test("a bare fraction is a count — nobody writes a quarter gram as 1/4", () => {
    expect(parseCell("1/4")).toEqual({ kind: "count", quantity: "1/4", size: null });
  });

  test("a range is a count, kept as written for the line parser", () => {
    expect(parseCell("3-4")).toEqual({ kind: "count", quantity: "3-4", size: null });
    expect(parseCell("12 – 14")).toEqual({ kind: "count", quantity: "12-14", size: null });
  });

  test("'taste' is present but deliberately unquantified", () => {
    expect(parseCell("taste").kind).toBe("unquantified");
    expect(parseCell("to taste").kind).toBe("unquantified");
  });

  test("blank cells are empty", () => {
    for (const blank of [null, undefined, "", "   "]) expect(parseCell(blank).kind).toBe("empty");
  });
});

describe("cellToLine — a faithful ordinary ingredient line", () => {
  test.each([
    ["Bread Flour", 273, "273 g bread flour"],
    ["Bread Flour", "AP 315", "315 g all-purpose flour"],
    ["Oil", "3 Tb", "3 tb oil"],
    ["Tomato", "28 oz", "28 oz tomato"],
    ["Garlic Cloves", "3 med", "3 medium garlic cloves"],
    ["Onion", "1/4", "1/4 onion"],
    ["Dry Oregano", "taste", "dry oregano, to taste"],
  ])("%s: %s → %s", (ingredient, raw, expected) => {
    expect(cellToLine(ingredient, parseCell(raw))).toBe(expected);
  });

  test("a row named for what it counts holds counts, not grams", () => {
    // "garlic cloves: 2" is two cloves. Read as grams it would be under one.
    expect(cellToLine("Garlic Cloves", parseCell(2))).toBe("2 garlic cloves");
  });

  test("an empty cell produces no line", () => {
    expect(cellToLine("Sugar", parseCell(null))).toBeNull();
  });
});

const FILE: CollectionFile = {
  dish: "detroit-pizza", convention: "bare-numbers-are-grams",
  compiledBy: "owner", compiledAt: "2026-09-20",
  sources: [
    { key: "a", siteName: "PizzaHog" },
    { key: "b", siteName: "Serious Eats", sourceUrl: "https://www.seriouseats.com/detroit-pizza" },
    { key: "mine", siteName: "House recipe", ownWork: true },
  ],
  sections: [
    { name: "dough", rows: [
      { ingredient: "Bread Flour", cells: { a: 273, b: 300, mine: 320 } },
      { ingredient: "Water", cells: { a: 205, b: 220, mine: 240 } },
    ] },
    { name: "sauce", rows: [{ ingredient: "Tomato", cells: { b: "28 oz" } }] },
  ],
};

describe("matrixToRecipes", () => {
  const recipes = matrixToRecipes(FILE);

  test("one recipe per source column, each naming its source", () => {
    expect(recipes.map((r) => r.provenance.siteName)).toEqual(["PizzaHog", "Serious Eats", "House recipe"]);
    for (const r of recipes) expect(() => assertProvenance(r.provenance)).not.toThrow();
  });

  test("keeps the sheet's sections and a flat union of lines", () => {
    const serious = recipes[1]!;
    expect(serious.sections!.map((s) => s.name)).toEqual(["dough", "sauce"]);
    expect(serious.ingredientLines).toEqual(["300 g bread flour", "220 g water", "28 oz tomato"]);
  });

  test("a source absent from a section simply has no such section", () => {
    expect(recipes[0]!.sections!.map((s) => s.name)).toEqual(["dough"]);
  });

  test("everything arrives private; the caller decides otherwise", () => {
    expect(recipes.every((r) => r.visibility === "private")).toBe(true);
  });

  test("each has a stable internal record, URL or not", () => {
    expect(internalRef(recipes[0]!)).toBe("/recipes/personal%3Adetroit-pizza%3Aa");
  });
});

describe("decideVisibility — notes are not a side door around permission review", () => {
  const open = { tier: "normal" as const, acquisition: "fetch" as const };

  test("no URL means private, whatever the source allows", () => {
    expect(decideVisibility(open, false, 0).visibility).toBe("private");
  });

  test("a URL plus a permitted source is public", () => {
    expect(decideVisibility(open, true, 0).visibility).toBe("public");
  });

  test("a source at acquisition none stays private even with a URL", () => {
    const atk = { tier: "required" as const, acquisition: "none" as const };
    expect(decideVisibility(atk, true, 0).visibility).toBe("private");
  });

  test("a manual-limited source is public only while under its cap", () => {
    const se = { tier: "required" as const, acquisition: "manual-limited" as const, manualCap: 2 };
    expect(decideVisibility(se, true, 1).visibility).toBe("public");
    expect(decideVisibility(se, true, 2).visibility).toBe("private");
  });

  test("the owner's own recipe is public with no URL at all", () => {
    expect(decideVisibility(open, false, 0, true).visibility).toBe("public");
  });
});

describe("isPublishable", () => {
  const [noUrl, , own] = matrixToRecipes(FILE);

  test("a named source with no link cannot be published, however well credited", () => {
    expect(isPublishable({ ...noUrl!, visibility: "public" })).toBe(false);
  });

  test("the owner's own recipe can — its internal record is the source", () => {
    expect(isPublishable({ ...own!, visibility: "public" })).toBe(true);
  });

  test("private is never publishable", () => {
    expect(isPublishable({ ...own!, visibility: "private" })).toBe(false);
  });
});
