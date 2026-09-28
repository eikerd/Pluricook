import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
  applyCorrections, readCorrections, removeCorrection, validateCorrection, writeCorrection,
  type RecipeCorrection,
} from "./corrections";
import type { ExtractedRecipe } from "../types/provenance";

const DISH = "zz-test-corrections";
afterEach(async () => { await rm(`data/corrections/${DISH}.json`, { force: true }); });

function recipe(id: string, lines: string[], sections?: Array<{ name: string; ingredientLines: string[] }>): ExtractedRecipe {
  return {
    id, dish: DISH, ingredientLines: lines, sections, stepCount: 3,
    servings: 4, servingsRaw: "4", totalTimeMinutes: 60, prepTimeMinutes: 20, cookTimeMinutes: 40, totalTimeRaw: "1 hr",
    provenance: {
      host: "test.example", siteName: "Test Kitchen", sourceUrl: null, author: null,
      sourceTitle: "Fritters", capturedAt: "2026-09-28", method: "personal-collection",
      acquisitionAtCapture: "fetch", licence: null,
    },
  };
}

const correction = (over: Partial<RecipeCorrection> = {}): RecipeCorrection => ({ correctedAt: "2026-09-28", ...over });

describe("applyCorrections", () => {
  test("a corrected recipe takes the owner's lines, sections, credit and facts", () => {
    const [r] = applyCorrections([recipe("a", ["1 cup flour"])], {
      a: correction({
        sections: [{ name: "dough", lines: ["360 g flour"] }, { name: "glaze", lines: ["300 g confectioners' sugar"] }],
        credit: { sourceTitle: "Apple Fritters", author: "Kitchen in the shire", sourceUrl: "https://example.com/fritters" },
        servings: 12, prepTimeMinutes: 30, cookTimeMinutes: 20, totalTimeMinutes: 50,
      }),
    });
    expect(r!.sections).toEqual([
      { name: "dough", ingredientLines: ["360 g flour"] },
      { name: "glaze", ingredientLines: ["300 g confectioners' sugar"] },
    ]);
    // Everything that reads the flat list sees the owner's lines too.
    expect(r!.ingredientLines).toEqual(["360 g flour", "300 g confectioners' sugar"]);
    expect(r!.provenance).toMatchObject({ sourceTitle: "Apple Fritters", author: "Kitchen in the shire", sourceUrl: "https://example.com/fritters" });
    expect(r).toMatchObject({ servings: 12, prepTimeMinutes: 30, cookTimeMinutes: 20, totalTimeMinutes: 50 });
  });

  test("one unnamed section is a recipe the source did not divide", () => {
    const [r] = applyCorrections([recipe("a", ["1 cup flour"])], { a: correction({ sections: [{ name: null, lines: ["360 g flour"] }] }) });
    expect(r!.sections).toBeUndefined();
    expect(r!.ingredientLines).toEqual(["360 g flour"]);
  });

  test("what a correction leaves out stays as published", () => {
    const [r] = applyCorrections([recipe("a", ["1 cup flour"])], { a: correction({ servings: 6 }) });
    expect(r!.ingredientLines).toEqual(["1 cup flour"]);
    expect(r!.provenance.sourceTitle).toBe("Fritters");
    expect(r!.servings).toBe(6);
    expect(r!.cookTimeMinutes).toBe(40);
  });

  test("the published recipe is never changed in place, and others pass through", () => {
    const published = [recipe("a", ["1 cup flour"]), recipe("b", ["2 eggs"])];
    const out = applyCorrections(published, { a: correction({ sections: [{ name: null, lines: ["360 g flour"] }] }) });
    expect(published[0]!.ingredientLines).toEqual(["1 cup flour"]);
    expect(out[1]).toBe(published[1]!);
  });
});

describe("validateCorrection", () => {
  const valid = { sections: [{ name: null, lines: ["360 g flour"] }], credit: { sourceTitle: "Fritters", author: null, sourceUrl: null } };

  test("keeps only the fields a correction may hold, trimmed", () => {
    const v = validateCorrection({ ...valid, sections: [{ name: " dough ", lines: [" 360 g flour ", "  "] }], steps: ["Fry."] });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.correction.sections).toEqual([{ name: "dough", lines: ["360 g flour"] }]);
    // Method text is the publisher's expression and has nowhere to go.
    expect("steps" in v.correction).toBe(false);
  });

  test.each([
    ["no lines at all", { ...valid, sections: [{ name: null, lines: [] }] }],
    ["a line that is not text", { ...valid, sections: [{ name: null, lines: [42] }] }],
    ["a line longer than a line", { ...valid, sections: [{ name: null, lines: ["x".repeat(301)] }] }],
    ["several sections, one unnamed", { ...valid, sections: [{ name: "dough", lines: ["1 g a"] }, { name: null, lines: ["1 g b"] }] }],
    ["a source that is not a web address", { ...valid, credit: { ...valid.credit, sourceUrl: "javascript:alert(1)" } }],
    ["servings that are not a whole number", { ...valid, servings: 2.5 }],
    ["a negative time", { ...valid, cookTimeMinutes: -5 }],
    ["an empty title", { ...valid, credit: { ...valid.credit, sourceTitle: "  " } }],
  ])("refuses %s", (_what, body) => {
    expect(validateCorrection(body).ok).toBe(false);
  });
});

describe("the corrections file", () => {
  test("a written correction reads back, and removing it leaves the file", async () => {
    await writeCorrection(DISH, "a", correction({ servings: 3 }));
    await writeCorrection(DISH, "b", correction({ servings: 5 }));
    expect((await readCorrections(DISH)).a?.servings).toBe(3);

    await removeCorrection(DISH, "a");
    const left = await readCorrections(DISH);
    expect(left.a).toBeUndefined();
    expect(left.b?.servings).toBe(5);
  });

  test("a dish with no corrections file has no corrections", async () => {
    expect(await readCorrections(DISH)).toEqual({});
  });
});
