import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { Glob } from "bun";
import { compareDish } from "./compare-service";
import { listRaggs, raggName, raggPage } from "./raggs";

// The figures come from the comparison, which opens usda.db; a fresh checkout has none.
const hasUsda = await Bun.file("usda.db").exists();
const recipeFiles = [...new Glob("data/recipes/*.json").scanSync(".")];

describe("a RAGG's name", () => {
  test("is its slug, spoken", () => {
    expect(raggName("detroit-pizza")).toBe("Detroit pizza");
    expect(raggName("meatloaf")).toBe("Meatloaf");
  });
});

describe("the RAGG list", () => {
  test.skipIf(!hasUsda)("holds one RAGG per recipe file, newest first", async () => {
    const raggs = await listRaggs();
    expect(raggs).toHaveLength(recipeFiles.length);
    const created = raggs.map((r) => r.created ?? "");
    expect(created).toEqual([...created].sort().reverse());
  });

  test.skipIf(!hasUsda)("its top ingredients are the ones the most recipes share, as the comparison counts them", async () => {
    const meatloaf = (await listRaggs()).find((r) => r.slug === "meatloaf")!;
    const outcome = await compareDish("meatloaf", null);
    if (!outcome.ok) throw new Error(outcome.error);
    const { common, occasional, outliers } = outcome.comparison;
    const counts = new Map([...common, ...occasional, ...outliers].map((c) => [c.foodDescription, c.recipeCount]));
    const most = Math.max(...counts.values());
    expect(meatloaf.topIngredients).toHaveLength(3);
    expect(counts.get(meatloaf.topIngredients[0]!)).toBe(most);
    const shown = meatloaf.topIngredients.map((f) => counts.get(f)!);
    expect(shown).toEqual([...shown].sort((a, b) => b - a));
  });

  test.skipIf(!hasUsda)("counts websites, not recipes: private notes have none", async () => {
    const pizza = (await listRaggs()).find((r) => r.slug === "detroit-pizza")!;
    expect(pizza.recipes).toBeGreaterThan(0);
    expect(pizza.sites).toBe(0);
  });
});

const BROKEN = "data/recipes/zz-ragg-broken.json";
afterEach(async () => { await rm(BROKEN, { force: true }); });

describe("a RAGG's page", () => {
  test.skipIf(!hasUsda)("lists every constituent recipe with its site", async () => {
    const outcome = await raggPage("lentil-soup");
    if (!outcome.ok) throw new Error(outcome.error);
    const { page } = outcome;
    expect(page.summary.name).toBe("Lentil soup");
    expect(page.recipes).toHaveLength(page.summary.recipes);
    expect(page.recipes.every((r) => r.site !== "" && r.lines > 0)).toBe(true);
  });

  test("a slug no RAGG has, or one that is not a slug, is not found", async () => {
    expect(await raggPage("no-such-dish")).toMatchObject({ ok: false, status: 404 });
    expect(await raggPage("../etc/passwd")).toMatchObject({ ok: false, status: 404 });
  });

  // Codex, PR #5 round 3: a hand-edited file that does not parse threw out of
  // the route, and the page showed a JSON parse error instead of naming the file.
  test("an unreadable recipe file is a failure that names the RAGG, not a throw", async () => {
    await Bun.write(BROKEN, "{ not json");
    const outcome = await raggPage("zz-ragg-broken");
    expect(outcome).toMatchObject({ ok: false, status: 500 });
    expect(outcome.ok ? "" : outcome.error).toContain("zz-ragg-broken");
  });
});
