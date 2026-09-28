import { describe, expect, test } from "bun:test";
import { categoryOf, USDA_CATEGORIES } from "./usda-categories";

describe("categoryOf", () => {
  test("an SR Legacy category is named and classed", () => {
    expect(categoryOf(1)).toEqual({ id: 1, system: "fdc", code: "0100", description: "Dairy and Egg Products", klass: "dairy" });
  });

  test("a WWEIA survey category is named and classed", () => {
    expect(categoryOf(1002)).toMatchObject({ system: "wweia", description: "Milk, whole", klass: "dairy" });
  });

  test("a category with no name on file still gets its class", () => {
    expect(categoryOf(99)).toMatchObject({ id: 99, description: "", klass: "unanchorable" });
  });

  test("no category is no category", () => {
    expect(categoryOf(null)).toBeNull();
  });

  test("the two systems' ids never meet", () => {
    const fdc = USDA_CATEGORIES.filter((c) => c.system === "fdc");
    expect(fdc.every((c) => c.id < 100)).toBe(true);
    expect(USDA_CATEGORIES.filter((c) => c.system === "wweia").every((c) => c.id >= 1000)).toBe(true);
  });
});
