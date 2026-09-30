import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { cloneRecipe, compareDish, deleteClone, listDishes, recipePage, revertCorrection, saveCorrection } from "./compare-service";
import { readCorrections } from "./corrections";

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

describe("recipePage", () => {
  // A page is described through usda.db; a fresh checkout has none, and answers 503.
  test.skipIf(!hasUsda)("a recipe's page is found by its id alone, whichever dish holds it", async () => {
    const result = await recipePage("natashaskitchen.com:meatloaf:2026-09-21");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.dish).toBe("meatloaf");
    expect(result.page.detail.sections.flatMap((s) => s.lines).length).toBeGreaterThan(0);
  });

  test("an id no dish holds answers 404 in the API's shape", async () => {
    expect(await recipePage("no-such-recipe")).toMatchObject({ ok: false, status: 404 });
  });
});

// Every successful write answers with the recipe's page, which needs usda.db.
describe.skipIf(!hasUsda)("corrections, end to end", () => {
  const DISH = "zz-test-page";
  const ID = "personal:zz-test-page:mine";
  afterEach(async () => {
    await rm(`data/recipes/${DISH}.json`, { force: true });
    await rm(`data/corrections/${DISH}.json`, { force: true });
  });

  const publish = () => Bun.write(`data/recipes/${DISH}.json`, JSON.stringify({
    dish: DISH,
    recipes: [{
      id: ID, dish: DISH, ingredientLines: ["300 g bread flour", "Brown Butter (from above)"],
      stepCount: null, servings: null, servingsRaw: null, totalTimeMinutes: null, prepTimeMinutes: null,
      cookTimeMinutes: null, totalTimeRaw: null,
      provenance: {
        host: null, siteName: "Test Kitchen", sourceUrl: null, author: null, sourceTitle: "Bread",
        capturedAt: "2026-09-28", method: "personal-collection", acquisitionAtCapture: "fetch", licence: null,
      },
    }],
  }));

  test("a saved correction reaches the page and the comparison; reverting restores the published recipe", async () => {
    await publish();
    const saved = await saveCorrection(ID, { sections: [{ name: null, lines: ["300 g bread flour", "45 g butter"] }] });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.page.detail.sections[0]!.lines.map((l) => l.line)).toEqual(["300 g bread flour", "45 g butter"]);
    expect(saved.page.published.sections[0]!.lines).toEqual(["300 g bread flour", "Brown Butter (from above)"]);
    expect(saved.page.correction?.sections).toBeDefined();

    const compared = await compareDish(DISH, null);
    expect(compared.ok && compared.comparison.unmatched.map((u) => u.rawLine)).not.toContain("Brown Butter (from above)");

    const reverted = await revertCorrection(ID);
    expect(reverted.ok && reverted.page.correction).toBeNull();
    expect(reverted.ok && reverted.page.detail.sections[0]!.lines.map((l) => l.line))
      .toEqual(["300 g bread flour", "Brown Butter (from above)"]);
  });

  test("a correction that fails validation is refused with its reason, and nothing is written", async () => {
    await publish();
    const refused = await saveCorrection(ID, { sections: [] });
    expect(refused).toMatchObject({ ok: false, status: 400 });
    expect(await readCorrections(DISH)).toEqual({});
  });

  describe("the owner's own copies", () => {
    afterEach(async () => { await rm(`data/clones/${DISH}.json`, { force: true }); });

    test("a copy joins its dish beside the original, and its page says what it began as", async () => {
      await publish();
      const made = await cloneRecipe(ID);
      expect(made).toEqual({ ok: true, id: `mine:${DISH}:test-kitchen` });
      if (!made.ok) return;

      const page = await recipePage(made.id);
      expect(page.ok && page.page.copy).toEqual({ clonedFrom: ID, originalSiteName: "Test Kitchen" });
      expect(page.ok && page.page.detail.siteName).toBe("Mine · Test Kitchen");

      const compared = await compareDish(DISH, null);
      expect(compared.ok && compared.comparison.recipes.map((r) => r.siteName).sort()).toEqual(["Mine · Test Kitchen", "Test Kitchen"]);
    });

    test("editing a copy rewrites the copy; the original and the corrections stay as they were", async () => {
      await publish();
      const made = await cloneRecipe(ID);
      if (!made.ok) throw new Error("no copy");
      const saved = await saveCorrection(made.id, { sections: [{ name: null, lines: ["350 g bread flour", "45 g butter"] }] });
      expect(saved.ok && saved.page.detail.sections[0]!.lines.map((l) => l.line)).toEqual(["350 g bread flour", "45 g butter"]);
      expect(await readCorrections(DISH)).toEqual({});
      const original = await recipePage(ID);
      expect(original.ok && original.page.detail.sections[0]!.lines.map((l) => l.line))
        .toEqual(["300 g bread flour", "Brown Butter (from above)"]);
    });

    test("a copy has no published version to revert to, and can be deleted; a captured recipe cannot", async () => {
      await publish();
      const made = await cloneRecipe(ID);
      if (!made.ok) throw new Error("no copy");
      expect(await revertCorrection(made.id)).toMatchObject({ ok: false, status: 400 });
      expect(await deleteClone(ID)).toMatchObject({ ok: false, status: 400 });
      expect(await deleteClone(made.id)).toEqual({ ok: true });
      expect(await recipePage(made.id)).toMatchObject({ ok: false, status: 404 });
    });
  });
});
