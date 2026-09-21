import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { compareDish, listDishes } from "./compare-service";

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

  test("a dish is named by its file, whatever the file says inside", async () => {
    await Bun.write(MISLABELLED, JSON.stringify({ dish: "meatloaf", recipes: [] }));
    const names = (await listDishes()).map((d) => d.dish);
    expect(names).toContain("zz-test-mislabelled");
    expect(names.filter((n) => n === "meatloaf")).toHaveLength(1);
  });
});

describe("compareDish", () => {
  test.each(["../../package", "Meatloaf", "meat loaf", ".hidden", ""])(
    "refuses %p as a dish name",
    async (name) => {
      const outcome = await compareDish(name, null);
      expect(outcome).toMatchObject({ ok: false, status: 404 });
    },
  );

  test("an unreadable recipe file answers in the API's shape, not a thrown error", async () => {
    await Bun.write(BROKEN, "{ not json");
    const outcome = await compareDish("zz-test-broken", null);
    expect(outcome).toMatchObject({ ok: false, status: 500 });
  });
});
