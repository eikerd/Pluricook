import { describe, expect, test } from "bun:test";
import { assertProvenance, creditLine, type Provenance } from "./provenance";

const GOOD: Provenance = {
  host: "recipetineats.com",
  siteName: "RecipeTin Eats",
  sourceUrl: "https://www.recipetineats.com/meatloaf-recipe/",
  author: "Nagi",
  sourceTitle: "Meatloaf recipe (extra delicious!)",
  capturedAt: "2026-09-20",
  method: "structured-data",
  acquisitionAtCapture: "fetch",
  licence: null,
};

describe("assertProvenance", () => {
  test("accepts a complete record", () => {
    expect(() => assertProvenance(GOOD)).not.toThrow();
  });

  test.each([
    ["host", ""],
    ["siteName", ""],
    ["sourceUrl", ""],
    ["sourceTitle", ""],
    ["capturedAt", ""],
  ] as const)("rejects a recipe missing %s", (field) => {
    expect(() => assertProvenance({ ...GOOD, [field]: "" })).toThrow(/identity is its source/);
  });

  test("rejects whitespace standing in for a source", () => {
    expect(() => assertProvenance({ ...GOOD, siteName: "   " })).toThrow();
  });

  test("rejects a sourceUrl that is not a reachable web address", () => {
    expect(() => assertProvenance({ ...GOOD, sourceUrl: "not a url" })).toThrow(/unusable sourceUrl/);
    expect(() => assertProvenance({ ...GOOD, sourceUrl: "javascript:alert(1)" })).toThrow(
      /unusable sourceUrl/,
    );
  });

  test("a missing author is allowed — many sites publish none", () => {
    expect(() => assertProvenance({ ...GOOD, author: null })).not.toThrow();
  });

  test("names every missing field at once, not just the first", () => {
    expect(() => assertProvenance({ ...GOOD, host: "", siteName: "" })).toThrow(/host, siteName/);
  });
});

describe("creditLine", () => {
  test("includes the author when the page names one", () => {
    expect(creditLine(GOOD)).toBe("RecipeTin Eats — Nagi");
  });

  test("falls back to the publication alone", () => {
    expect(creditLine({ ...GOOD, author: null })).toBe("RecipeTin Eats");
  });
});
