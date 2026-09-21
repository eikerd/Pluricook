import { describe, expect, test } from "bun:test";
import { countPublicHandEntered, isHandEntered } from "./hand-entry";
import { mayCaptureManually } from "./curated-sources";
import type { ExtractedRecipe } from "../types/provenance";

function recipe(
  id: string,
  method: ExtractedRecipe["provenance"]["method"],
  visibility: "public" | "private" = "public",
  host = "seriouseats.com",
): ExtractedRecipe {
  return {
    id, dish: "pizza", ingredientLines: ["300 g flour"], visibility,
    servings: null, servingsRaw: null, totalTimeMinutes: null, totalTimeRaw: null,
    prepTimeMinutes: null, cookTimeMinutes: null, stepCount: null,
    provenance: {
      host, siteName: "Serious Eats", sourceUrl: `https://${host}/${id}`, author: null,
      sourceTitle: "x", capturedAt: "2026-09-20", method,
      acquisitionAtCapture: "manual-limited", licence: null,
    },
  };
}

describe("isHandEntered", () => {
  test("both methods that put a person between the page and the corpus", () => {
    expect(isHandEntered(recipe("a", "manual-transcription"))).toBe(true);
    expect(isHandEntered(recipe("b", "personal-collection"))).toBe(true);
    expect(isHandEntered(recipe("c", "structured-data"))).toBe(false);
  });
});

describe("countPublicHandEntered — one cap, shared by both hand-entry methods", () => {
  const held = [
    recipe("m1", "manual-transcription"),
    recipe("p1", "personal-collection"),
    recipe("p2", "personal-collection", "private"),
    recipe("f1", "structured-data"),
    recipe("other", "manual-transcription", "public", "example.com"),
  ];

  test("counts manual AND personal-collection records together", () => {
    // The bug: add-manual-recipe counted only manual-transcription, so a personal
    // import and a manual entry could each consume a full cap.
    expect(countPublicHandEntered(held, "seriouseats.com")).toBe(2);
  });

  test("private records do not count — the cap governs what is published", () => {
    expect(countPublicHandEntered([recipe("p", "personal-collection", "private")], "seriouseats.com")).toBe(0);
  });

  test("fetched recipes and other hosts do not count", () => {
    expect(countPublicHandEntered(held, "example.com")).toBe(1);
  });

  test("records a re-import is about to replace are left out", () => {
    const sheet = [recipe("personal:pizza:serious", "personal-collection"), recipe("m1", "manual-transcription")];
    expect(countPublicHandEntered(sheet, "seriouseats.com", "personal:pizza:")).toBe(1);
  });

  test("the doubled-cap scenario is now refused", () => {
    const site = { tier: "required" as const, acquisition: "manual-limited" as const, manualCap: 2 };
    const both = [recipe("p1", "personal-collection"), recipe("p2", "personal-collection")];
    // Two public personal imports fill a cap of 2; a manual entry must be refused.
    expect(mayCaptureManually(site, countPublicHandEntered(both, "seriouseats.com")).ok).toBe(false);
  });
});
