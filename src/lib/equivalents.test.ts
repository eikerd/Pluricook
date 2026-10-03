import { describe, expect, test } from "bun:test";
import { compareDish } from "./compare-service";
import { buildEquivalents, readEquivalents } from "./equivalents";

describe("buildEquivalents", () => {
  test("every member folds into its group's USDA food; that food maps to itself", () => {
    const map = buildEquivalents({ groups: [{ name: "Lentils", fdcId: 1, members: [2, 3], note: "" }] });
    expect(map.get(2)).toBe(1);
    expect(map.get(3)).toBe(1);
    expect(map.get(1)).toBeUndefined();
    expect(map.get(9)).toBeUndefined();
  });

  test("a food in two groups is refused by name, rather than folding wherever it was read last", () => {
    expect(() => buildEquivalents({
      groups: [{ name: "A", fdcId: 1, members: [5], note: "" }, { name: "B", fdcId: 2, members: [5], note: "" }],
    })).toThrow(/5.*A.*B/);
  });

  test("a group's own food cannot be another group's member: one step, never a chain", () => {
    expect(() => buildEquivalents({
      groups: [{ name: "A", fdcId: 1, members: [2], note: "" }, { name: "B", fdcId: 3, members: [1], note: "" }],
    })).toThrow(/1/);
  });

  test("an id that is not a whole number is refused", () => {
    expect(() => buildEquivalents({ groups: [{ name: "A", fdcId: 1, members: ["2" as unknown as number], note: "" }] })).toThrow();
  });

  test("the repo's own file reads", async () => {
    expect((await readEquivalents()).size).toBeGreaterThan(0);
  });
});

// The comparison opens usda.db; a fresh checkout has none.
const hasUsda = await Bun.file("usda.db").exists();

describe("the comparison, with equivalents", () => {
  // The owner, 2026-09-30: broths that "can probably be substituted for the
  // exact same USDA one" must not split the chart into four bands.
  test.skipIf(!hasUsda)("lentil soup has one broth and one lentil, whatever each recipe matched", async () => {
    const outcome = await compareDish("lentil-soup", null);
    if (!outcome.ok) throw new Error(outcome.error);
    const { common, occasional, outliers } = outcome.comparison;
    const names = [...common, ...occasional, ...outliers].map((c) => c.foodDescription);
    expect(names.filter((n) => n.startsWith("Lentils"))).toEqual(["Lentils, raw"]);
    expect(names.filter((n) => /broth|stock/i.test(n))).toEqual(["Soup, chicken broth, ready-to-serve"]);
    const lentils = [...common, ...occasional, ...outliers].find((c) => c.foodDescription === "Lentils, raw")!;
    expect(lentils.recipeCount).toBe(outcome.comparison.analysed);
  });
});
