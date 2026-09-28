import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { compareDish, listDishes, recipeDetail } from "./compare-service";

const BROKEN = "data/recipes/zz-test-broken.json";
const MISLABELLED = "data/recipes/zz-test-mislabelled.json";

afterEach(async () => {
  await rm(BROKEN, { force: true });
  await rm(MISLABELLED, { force: true });
});

describe("listDishes", () => {
  test("one unreadable file costs one dish, not the whole list", async () => {
    await Bun.write(BROKEN, "{ not json");
    const dishes = await listDishes();
    expect(dishes.map((d) => d.dish)).toContain("meatloaf");
    expect(dishes.map((d) => d.dish)).not.toContain("zz-test-broken");
  });

  test.each([
    ["a null entry", { recipes: [null] }],
    ["an entry with no ingredient lines", { recipes: [{ id: "x" }] }],
    ["sections that are not a list", { recipes: [{ id: "x", ingredientLines: [], sections: "dough" }] }],
    ["a section with no lines", { recipes: [{ id: "x", ingredientLines: [], sections: [{ name: "dough" }] }] }],
    ["an entry with no id", { recipes: [{ ingredientLines: [], provenance: { siteName: "a" } }] }],
    ["an entry with no source", { recipes: [{ id: "x", ingredientLines: [] }] }],
  ])("valid JSON with %s costs one dish, not the whole list", async (_what, body) => {
    await Bun.write(BROKEN, JSON.stringify(body));
    const names = (await listDishes()).map((d) => d.dish);
    expect(names).toContain("meatloaf");
    expect(names).not.toContain("zz-test-broken");
  });

  test("a dish is named by its file, whatever the file says inside", async () => {
    await Bun.write(MISLABELLED, JSON.stringify({ dish: "meatloaf", recipes: [] }));
    const names = (await listDishes()).map((d) => d.dish);
    expect(names).toContain("zz-test-mislabelled");
    expect(names.filter((n) => n === "meatloaf")).toHaveLength(1);
  });
});

const hasUsda = await Bun.file("usda.db").exists();

describe("compareDish", () => {
  // Needs usda.db only because compareDish opens it before comparing.
  test.skipIf(!hasUsda)("answers under the name it was asked for, not the one inside the file", async () => {
    const { recipes } = (await Bun.file("data/recipes/meatloaf.json").json()) as { recipes: unknown[] };
    await Bun.write(MISLABELLED, JSON.stringify({ dish: "meatloaf", recipes: recipes.slice(0, 2) }));

    const outcome = await compareDish("zz-test-mislabelled", null);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.comparison.dish).toBe("zz-test-mislabelled");
      expect(outcome.comparison.analysed).toBe(2);
    }
  });

  test.skipIf(!hasUsda)("an empty file still answers under its own name", async () => {
    await Bun.write(MISLABELLED, JSON.stringify({ dish: "meatloaf", recipes: [] }));
    const outcome = await compareDish("zz-test-mislabelled", null);
    expect(outcome).toMatchObject({ ok: true, comparison: { dish: "zz-test-mislabelled", analysed: 0 } });
  });

  test.each(["../../package", "Meatloaf", "meat loaf", ".hidden", ""])(
    "refuses %p as a dish name",
    async (name) => {
      const outcome = await compareDish(name, null);
      expect(outcome).toMatchObject({ ok: false, status: 404 });
    },
  );

  test("a malformed entry answers in the API's shape, naming the recipe", async () => {
    await Bun.write(BROKEN, JSON.stringify({ recipes: [null] }));
    const outcome = await compareDish("zz-test-broken", null);
    expect(outcome).toMatchObject({ ok: false, status: 500 });
  });

  test("an unreadable recipe file answers in the API's shape, not a thrown error", async () => {
    await Bun.write(BROKEN, "{ not json");
    const outcome = await compareDish("zz-test-broken", null);
    expect(outcome).toMatchObject({ ok: false, status: 500 });
  });
});

describe("recipeDetail", () => {
  test("a captured recipe is described, credit and lines", async () => {
    const result = await recipeDetail("meatloaf", "natashaskitchen.com:meatloaf:2026-09-21");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.siteName).toBeTruthy();
    expect(result.detail.sections.flatMap((s) => s.lines).length).toBeGreaterThan(0);
  });

  test("a recipe the dish does not hold answers 404 in the API's shape", async () => {
    expect(await recipeDetail("meatloaf", "no-such-recipe")).toMatchObject({ ok: false, status: 404 });
  });

  test("a dish that is not a plain slug is refused before any file is opened", async () => {
    expect(await recipeDetail("../meatloaf", "x")).toMatchObject({ ok: false, status: 404 });
  });
});
