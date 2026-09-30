import { describe, expect, test } from "bun:test";
import { recipeIdFromPath, recipePath, termPath, termSlugFromPath, usdaFoodIdFromPath, usdaFoodPath } from "./route";

describe("a search term's address", () => {
  test("names the term by its slug, both ways", () => {
    expect(termPath("meatloaf")).toBe("/terms/meatloaf");
    expect(termSlugFromPath("/terms/lentil-soup")).toBe("lentil-soup");
  });

  test("anything but a dish key names no term", () => {
    for (const path of ["/terms/", "/terms/Meatloaf", "/terms/-x", "/terms/a/b", "/terms/a%20b", "/recipes/meatloaf"]) {
      expect(termSlugFromPath(path)).toBeNull();
    }
  });
});

describe("a USDA food's address", () => {
  test("names the food by its FDC id, both ways", () => {
    expect(usdaFoodPath(167512)).toBe("/usda/167512");
    expect(usdaFoodIdFromPath("/usda/167512")).toBe(167512);
  });

  test("anything but a whole number names no food", () => {
    for (const path of ["/usda/", "/usda/abc", "/usda/12x", "/usda/-1", "/usda/1.5", "/usda/12/34", "/recipes/167512", "/"]) {
      expect(usdaFoodIdFromPath(path)).toBeNull();
    }
  });
});

describe("a recipe's address", () => {
  test("carries any id through, escaped", () => {
    const id = "mine:meatloaf:the-modern-proper";
    expect(recipeIdFromPath(recipePath(id))).toBe(id);
  });

  test("a malformed escape names no recipe, and a food's address is not a recipe's", () => {
    expect(recipeIdFromPath("/recipes/%E0%A4%A")).toBeNull();
    expect(recipeIdFromPath("/usda/167512")).toBeNull();
  });
});
