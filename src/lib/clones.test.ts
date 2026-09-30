import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { makeClone, readClones, writeClones } from "./clones";
import { assertProvenance, type ExtractedRecipe } from "../types/provenance";

const DISH = "zz-test-clones";
afterEach(async () => { await rm(`data/clones/${DISH}.json`, { force: true }); });

const original: ExtractedRecipe = {
  id: "seriouseats.com:zz-test-clones:2026-09-21",
  dish: DISH,
  ingredientLines: ["300 g bread flour", "220 g water"],
  sections: [{ name: "dough", ingredientLines: ["300 g bread flour", "220 g water"] }],
  stepCount: 6, servings: 4, servingsRaw: "4", totalTimeMinutes: 90, prepTimeMinutes: 30, cookTimeMinutes: 60,
  totalTimeRaw: "1 hr 30 min",
  provenance: {
    host: "seriouseats.com", siteName: "Serious Eats", sourceUrl: "https://www.seriouseats.com/detroit-pizza",
    author: "J. Kenji López-Alt", sourceTitle: "Detroit-Style Pizza", capturedAt: "2026-09-21",
    method: "structured-data", acquisitionAtCapture: "fetch", licence: null,
  },
};

describe("makeClone", () => {
  test("a clone is the owner's own private copy, naming what it began as", () => {
    const c = makeClone(original, DISH, new Set([original.id]), "2026-09-28");
    expect(c.id).toBe(`mine:${DISH}:serious-eats`);
    expect(c.clonedFrom).toBe(original.id);
    expect(c.visibility).toBe("private");
    expect(c.provenance).toMatchObject({
      siteName: "Mine · Serious Eats", sourceTitle: "Detroit-Style Pizza", method: "owner-copy",
      sourceUrl: null, host: null, capturedAt: "2026-09-28",
    });
    // Its provenance passes the same gate every recipe must.
    expect(() => assertProvenance(c.provenance)).not.toThrow();
  });

  test("it carries the recipe's lines, sections and figures", () => {
    const c = makeClone(original, DISH, new Set(), "2026-09-28");
    expect(c.ingredientLines).toEqual(original.ingredientLines);
    expect(c.sections).toEqual(original.sections);
    expect(c).toMatchObject({ servings: 4, prepTimeMinutes: 30, cookTimeMinutes: 60, totalTimeMinutes: 90 });
  });

  test("editing the clone can never reach the original", () => {
    const c = makeClone(original, DISH, new Set(), "2026-09-28");
    c.ingredientLines.push("5 g salt");
    c.sections![0]!.ingredientLines.push("5 g salt");
    expect(original.ingredientLines).toHaveLength(2);
    expect(original.sections![0]!.ingredientLines).toHaveLength(2);
  });

  test("a second copy of the same recipe gets an id of its own", () => {
    const first = makeClone(original, DISH, new Set(), "2026-09-28");
    const second = makeClone(original, DISH, new Set([first.id]), "2026-09-28");
    expect(second.id).toBe(`mine:${DISH}:serious-eats-2`);
  });
});

describe("the clones file", () => {
  test("clones written for a dish read back", async () => {
    const c = makeClone(original, DISH, new Set(), "2026-09-28");
    await writeClones(DISH, [c]);
    expect((await readClones(DISH)).map((r) => r.id)).toEqual([c.id]);
  });

  test("a dish with no clones file has no clones", async () => {
    expect(await readClones(DISH)).toEqual([]);
  });
});
