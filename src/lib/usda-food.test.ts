/** Against the real usda.db, as the other USDA tests are: the record is the point. */

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { queryDataset } from "./admin-queries";
import { usdaFood } from "./usda-food";

const USDA = "usda.db";
const available = await Bun.file(USDA).exists();
const db = available ? new Database(USDA, { readonly: true }) : null;
const withDb = available ? describe : describe.skip;

withDb("usdaFood", () => {
  test("a food's page holds every field of its record, and its category named and classed", () => {
    const page = usdaFood(db!, 167512)!;
    expect(page.food).toEqual({
      fdcId: 167512, dataset: "sr-legacy", dataType: "sr_legacy_food",
      description: "Pillsbury Golden Layer Buttermilk Biscuits, Artificial Flavor, refrigerated dough", categoryId: 18,
    });
    expect(page.category).toMatchObject({ id: 18, system: "fdc", description: "Baked Products", klass: "unanchorable" });
  });

  test("it lists the food's portions and nutrients in full", () => {
    const withPortions = db!.query<{ fdc_id: number }, []>("SELECT fdc_id FROM portions GROUP BY fdc_id HAVING COUNT(*) > 2 LIMIT 1").get()!;
    const page = usdaFood(db!, withPortions.fdc_id)!;
    const counted = db!.query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM portions WHERE fdc_id = ?1").get(withPortions.fdc_id)!;
    expect(page.portions).toHaveLength(counted.n);
    expect(page.nutrients.length).toBeGreaterThan(0);
    expect(page.nutrients[0]).toHaveProperty("unit");
  });

  test("it lists every nutrient row the food has, even one whose nutrient is not defined", () => {
    // Survey foods' rows carry USDA's old nutrient numbers, which the nutrients
    // table does not hold; an inner join dropped them all and Abalone read as
    // having no nutrients.
    const abalone = 2706337;
    const rows = db!.query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM food_nutrients WHERE fdc_id = ?1").get(abalone)!;
    expect(rows.n).toBeGreaterThan(0);
    expect(usdaFood(db!, abalone)!.nutrients).toHaveLength(rows.n);
  });

  test("an id USDA does not have is null", () => {
    expect(usdaFood(db!, -1)).toBeNull();
  });
});

withDb("the USDA foods table", () => {
  test("carries each food's category and class, sortable and searchable", async () => {
    const page = await queryDataset("usda-foods", { q: "Dairy and Egg", sort: "klass", dir: "asc", pageSize: 5 });
    expect(page!.columns.map((c) => c.key)).toEqual(expect.arrayContaining(["category", "klass"]));
    expect(page!.total).toBeGreaterThan(0);
    expect(page!.rows[0]).toMatchObject({ category: "Dairy and Egg Products", klass: "dairy" });
  });

  test("every column still sorts once the categories are joined in — both tables have a description", async () => {
    const page = await queryDataset("usda-foods", { pageSize: 1 });
    for (const { key } of page!.columns) {
      for (const dir of ["asc", "desc"]) {
        expect(await queryDataset("usda-foods", { sort: key, dir, pageSize: 1 })).toHaveProperty("total", page!.total);
      }
    }
  });
});
