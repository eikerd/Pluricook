/**
 * Our own table of what the USDA datasets we load do not hold. The arithmetic
 * runs anywhere; the conversions run against the real usda.db, as
 * to-grams.test.ts does, because a dry-equivalent is only as good as the water
 * figures USDA publishes.
 */

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { compareRecipes } from "./compare";
import { readAliases } from "./ingredient-aliases";
import { buildNotInUsda, dryFactor, readNotInUsda } from "./not-in-usda";
import { toGrams } from "./to-grams";
import type { ExtractedRecipe } from "../types/provenance";

const available = await Bun.file("usda.db").exists();
const db = available ? new Database("usda.db", { readonly: true }) : null;
const withDb = available ? describe : describe.skip;

describe("dryFactor", () => {
  test("is the ratio of dry matter, fresh to dry", () => {
    // Pasta, fresh-refrigerated 31.0% water; Pasta, dry, enriched 9.9%.
    expect(dryFactor(31.0, 9.9)).toBeCloseTo(69 / 90.1, 6);
  });
});

describe("buildNotInUsda", () => {
  const food = {
    kind: "food", description: "X", categoryId: 6, sodiumMgPer100g: 1,
    portions: [], source: "s",
  };

  test("refuses an id that could be a USDA fdc_id", () => {
    expect(() => buildNotInUsda({ entries: { x: { ...food, id: 5 } } })).toThrow(/negative/);
  });

  test("refuses two entries with one id", () => {
    expect(() => buildNotInUsda({ entries: { x: { ...food, id: -1 }, y: { ...food, id: -1 } } })).toThrow(/-1/);
  });

  test("the table on disk loads", async () => {
    const table = await readNotInUsda();
    expect(table.byId.size).toBeGreaterThan(0);
  });
});

withDb("a food USDA lacks — Maggi Seasoning", () => {
  test("converts by our spec, and says so", async () => {
    const r = toGrams({ quantity: 2, unit: "teaspoons", name: "maggi seasoning", db: db!, aliases: await readAliases() });
    expect(r.basis).toBe("not-in-usda");
    expect(r.fdcId).toBeLessThan(0);
    expect(r.grams).toBe(10.6);
    expect(r.foodDescription).toContain("Maggi");
    expect(r.workaround).toContain("not in USDA");
  });

  test("carries its sodium into the salinity reading", async () => {
    const recipe = {
      id: "t:maggi", dish: "t", ingredientLines: ["1 tablespoon Maggi Seasoning", "1 lb dried spaghetti"],
      provenance: { siteName: "Test", host: "t", sourceUrl: "https://t/", author: null, sourceTitle: "t",
        capturedAt: "2026-09-30", method: "structured-data", acquisitionAtCapture: "fetch", licence: null },
      servings: null,
    } as unknown as ExtractedRecipe;
    const cmp = compareRecipes({ recipes: [recipe], db: db!, aliases: await readAliases() });
    // Maggi 16 g × 7,979 mg/100 g = 1,276.6, plus 453.6 g of dry pasta × 6 mg/100 g = 27.2.
    expect(cmp.recipes[0]!.sodiumMg).toBe(1304);
  });
});

withDb("a form USDA lacks — fresh noodles counted as dry (G22)", () => {
  test("a fresh-noodle mass becomes its dry equivalent, on the dry record", async () => {
    const r = toGrams({
      quantity: 20, unit: "oz", name: "Sun Noodle, Kaedama (or substitute dried spaghetti noodles)",
      db: db!, aliases: await readAliases(),
    });
    expect(r.basis).toBe("counted-as-dry");
    expect(r.foodDescription).toBe("Pasta, dry, enriched");
    // 567 g fresh × 69/90.1
    expect(r.grams).toBeCloseTo(567 * (69 / 90.1), 0);
    expect(r.workaround).toContain("fresh");
    expect(r.note).toContain("567");
  });

  test("fresh egg noodles count as dry egg noodles", async () => {
    const r = toGrams({ quantity: 14, unit: "oz", name: "package of fresh egg noodles", db: db!, aliases: await readAliases() });
    expect(r.basis).toBe("counted-as-dry");
    expect(r.foodDescription).toBe("Noodles, egg, dry, enriched");
  });

  test("a fresh noodle by volume is refused, not guessed", async () => {
    const r = toGrams({ quantity: 2, unit: "cup", name: "fresh egg noodles", db: db!, aliases: await readAliases() });
    expect(r.grams).toBeNull();
    expect(r.basis).toBe("no-portion-match");
  });
});
