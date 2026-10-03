import { describe, expect, test } from "bun:test";
import type { RecipePageData } from "../lib/compare-service";
import type { RecipeDetail } from "../lib/recipe-detail";
import { correctionFrom, draftFrom, fullCorrection, pairParsed, rowsOf, withRows } from "./recipe-draft";

const line = (text: string) => ({ line: text, grams: null, share: null, food: null, workaround: null, read: { quantity: 0, unit: "each", name: text, statedGrams: null } });

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

describe("the lines as spreadsheet rows", () => {
  test("one row per line, carrying its section; read back unchanged they are no correction", () => {
    const draft = draftFrom(detail);
    expect(rowsOf(draft)).toEqual([
      { section: "dough", line: "360 g flour" },
      { section: "dough", line: "6 g salt" },
      { section: "glaze", line: "300 g sugar" },
    ]);
    expect(correctionFrom(withRows(draft, rowsOf(draft)), published)).toBeNull();
  });

  test("typing another section's name into a row moves the line there", () => {
    const draft = draftFrom(detail);
    const rows = rowsOf(draft).map((r) => (r.line === "6 g salt" ? { ...r, section: "glaze" } : r));
    expect(correctionFrom(withRows(draft, rows), published)).toEqual({
      sections: [{ name: "dough", lines: ["360 g flour"] }, { name: "glaze", lines: ["6 g salt", "300 g sugar"] }],
    });
  });

  test("a new section name starts a section, in the order rows first name it", () => {
    const draft = draftFrom(detail);
    const rows = [...rowsOf(draft), { section: " topping ", line: "20 g sprinkles" }];
    expect(withRows(draft, rows).sections).toEqual([
      { name: "dough", text: "360 g flour\n6 g salt" },
      { name: "glaze", text: "300 g sugar" },
      { name: "topping", text: "20 g sprinkles" },
    ]);
  });

  test("a row cleared of its line is deleted, and a section left with no lines goes with it", () => {
    const draft = draftFrom(detail);
    const rows = rowsOf(draft).map((r) => (r.section === "glaze" ? { ...r, line: "  " } : r));
    expect(correctionFrom(withRows(draft, rows), published)).toEqual({
      sections: [{ name: "dough", lines: ["360 g flour", "6 g salt"] }],
    });
  });
});

describe("pairParsed", () => {
  const read = [line("360 g flour"), line("6 g salt"), line("300 g sugar")];

  // Review of PR #5: by position, a deleted line shifted every later row onto
  // its neighbour's grams and USDA food — undimmed, once a save had failed.
  test("each row takes the reading of its own line, not of the line in its place", () => {
    const rows = [{ section: "", line: "360 g flour" }, { section: "", line: "300 g sugar" }];
    expect(pairParsed(rows, read).map((p) => p?.line ?? null)).toEqual(["360 g flour", "300 g sugar"]);
  });

  test("a line not yet read has none, and a line listed twice takes one reading each", () => {
    const twice = [...read, line("6 g salt")];
    const rows = [{ section: "", line: "6 g salt" }, { section: "", line: "50 g egg" }, { section: "", line: "6 g salt" }];
    const paired = pairParsed(rows, twice);
    expect(paired.map((p) => p?.line ?? null)).toEqual(["6 g salt", null, "6 g salt"]);
    expect(paired[0]).not.toBe(paired[2]);
  });
});

describe("fullCorrection", () => {
  // Review of PR #5: a copy edited and edited back before the first save
  // returned diffed as "no change" against its stale stored self, and kept the edit.
  test("carries every field, so it restores the recipe whatever the server holds", () => {
    const full = fullCorrection(draftFrom(detail));
    expect(full).toEqual({
      credit: { sourceTitle: "Fritters", author: null, sourceUrl: null },
      servings: 4, prepTimeMinutes: null, cookTimeMinutes: 20, totalTimeMinutes: null,
      sections: [{ name: "dough", lines: ["360 g flour", "6 g salt"] }, { name: "glaze", lines: ["300 g sugar"] }],
    });
  });
});
