import { describe, expect, test } from "bun:test";
import type { RecipePageData } from "../lib/compare-service";
import type { RecipeDetail } from "../lib/recipe-detail";
import { correctionFrom, draftFrom } from "./recipe-draft";

const line = (text: string) => ({ line: text, grams: null, share: null, food: null, read: { quantity: 0, unit: "each", name: text, statedGrams: null } });

const published: RecipePageData["published"] = {
  sourceTitle: "Fritters",
  author: null,
  sourceUrl: null,
  facts: { servings: 4, prepTimeMinutes: null, cookTimeMinutes: 20, totalTimeMinutes: null },
  sections: [{ name: "dough", lines: ["360 g flour", "6 g salt"] }, { name: "glaze", lines: ["300 g sugar"] }],
};

const detail: RecipeDetail = {
  recipeId: "x", siteName: "Test Kitchen", sourceTitle: "Fritters", author: null, sourceUrl: null,
  facts: published.facts, totalGrams: 666,
  sections: published.sections.map((s) => ({ name: s.name, lines: s.lines.map(line) })),
};

describe("correctionFrom", () => {
  test("an untouched draft is no correction at all", () => {
    expect(correctionFrom(draftFrom(detail), published)).toBeNull();
  });

  test("only what differs from the published recipe is sent", () => {
    const draft = draftFrom(detail);
    draft.sections[0]!.text = "360 g flour\n6 g salt\n50 g egg";
    expect(correctionFrom(draft, published)).toEqual({
      sections: [{ name: "dough", lines: ["360 g flour", "6 g salt", "50 g egg"] }, { name: "glaze", lines: ["300 g sugar"] }],
    });
  });

  test("credit is sent whole when any part of it changes", () => {
    const draft = { ...draftFrom(detail), author: " Kitchen in the shire " };
    expect(correctionFrom(draft, published)).toEqual({
      credit: { sourceTitle: "Fritters", author: "Kitchen in the shire", sourceUrl: null },
    });
  });

  test("a cleared figure is sent as null; a changed one as a number", () => {
    const draft = { ...draftFrom(detail), servings: "", cookTimeMinutes: "25" };
    expect(correctionFrom(draft, published)).toEqual({ servings: null, cookTimeMinutes: 25 });
  });

  test("a figure that is not a whole number goes as written, for the server to refuse by name", () => {
    expect(correctionFrom({ ...draftFrom(detail), servings: "a dozen" }, published)).toEqual({ servings: "a dozen" });
  });

  test("blank rows and surrounding space are not lines", () => {
    const draft = draftFrom(detail);
    draft.sections[1]!.text = "  300 g sugar  \n\n   \n";
    expect(correctionFrom(draft, published)).toBeNull();
  });
});
