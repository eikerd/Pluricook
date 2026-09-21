/**
 * Merge a fresh extraction run into the recipes already held for a dish.
 *
 * A refresh must never shrink the corpus by accident. Writing only what one run
 * produced would delete every hand-entered recipe — those are never re-fetched,
 * by design — and would also drop any recipe whose site happened to be
 * unreachable that day. A transient 403 is not evidence that a recipe stopped
 * existing.
 */

import { canonicalUrl } from "./site-registry";
import type { ExtractedRecipe } from "../types/provenance";

export interface MergeResult {
  recipes: ExtractedRecipe[];
  /** Recipes re-extracted this run, replacing what was held. */
  refreshed: number;
  /** Recipes new to the corpus. */
  added: number;
  /** Recipes held before and not touched by this run. */
  kept: number;
  /** Of those kept, how many were entered by hand. */
  keptManual: number;
}

export function mergeRecipes(
  existing: ExtractedRecipe[],
  fresh: ExtractedRecipe[],
): MergeResult {
  const byUrl = new Map<string, ExtractedRecipe>();
  for (const r of existing) byUrl.set(canonicalUrl(r.provenance.sourceUrl), r);

  let refreshed = 0;
  let added = 0;
  const touched = new Set<string>();

  for (const r of fresh) {
    const key = canonicalUrl(r.provenance.sourceUrl);
    // Two spellings of one page in a single run are one recipe.
    if (touched.has(key)) continue;
    touched.add(key);

    const held = byUrl.get(key);
    // A hand-entered recipe is never overwritten by a fetch: the person who
    // typed it in read the page, and an extractor's reading is not more
    // authoritative than theirs.
    if (held?.provenance.method === "manual-transcription") continue;

    if (held) refreshed++;
    else added++;
    byUrl.set(key, r);
  }

  const recipes = [...byUrl.values()];
  const untouched = recipes.filter((r) => !touched.has(canonicalUrl(r.provenance.sourceUrl)) ||
    r.provenance.method === "manual-transcription");

  return {
    recipes,
    refreshed,
    added,
    kept: recipes.length - refreshed - added,
    keptManual: untouched.filter((r) => r.provenance.method === "manual-transcription").length,
  };
}
