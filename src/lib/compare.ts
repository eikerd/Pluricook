/**
 * Consensus and variation across the recipes captured for one dish.
 *
 * Ingredients are clustered by USDA `fdc_id` rather than by fuzzy string
 * matching. The gram conversion already resolved each line to a food record, so
 * that identifier is a natural, free key — "2 lb ground beef", "1½ lbs lean
 * ground beef" and "500g beef mince" collapse without any string heuristics.
 *
 * The cost is that clustering inherits the matcher's mistakes: where a line
 * resolves to the wrong food, it clusters with the wrong food. Those failures
 * are visible in `unmatched` and in the known-gap tests rather than hidden.
 *
 * Quantities are compared PER SERVING. A recipe serving four and one serving
 * eight are not comparable by absolute mass, and the corpus mixes 4, 6 and 8.
 */

import type { Database } from "bun:sqlite";
import { parseIngredientLine } from "./ingredient-parser";
import { toGrams, type Basis } from "./to-grams";
import { EMPTY_TABLE, type AliasTable } from "./ingredient-aliases";
import type { ExtractedRecipe } from "../types/provenance";

export interface SourceAmount {
  siteName: string;
  sourceUrl: string;
  /** The line exactly as published, so a surprising number can be checked. */
  rawLine: string;
  grams: number;
  /** Grams divided by that recipe's stated servings. */
  gramsPerServing: number | null;
  basis: Basis;
}

export interface IngredientCluster {
  fdcId: number;
  foodDescription: string;
  /** How many recipes include it. */
  recipeCount: number;
  /** recipeCount / recipes analysed, 0-1. */
  frequency: number;
  medianGrams: number;
  minGrams: number;
  maxGrams: number;
  medianPerServing: number | null;
  /** max / min for per-serving amounts — how much the corpus disagrees. */
  spread: number | null;
  sources: SourceAmount[];
}

export interface Comparison {
  dish: string;
  /** Recipes with enough data to take part. */
  analysed: number;
  /** Recipes excluded for having no servings count. */
  skippedNoServings: number;
  /** In at least this share of recipes. */
  commonThreshold: number;
  common: IngredientCluster[];
  /** Present in only one or two recipes. */
  outliers: IngredientCluster[];
  /** Lines that never reached a food record, by reason. */
  unmatched: Array<{ siteName: string; rawLine: string; basis: Basis }>;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

export interface CompareOptions {
  recipes: ExtractedRecipe[];
  db: Database;
  /** Share of recipes an ingredient must appear in to count as consensus. */
  commonThreshold?: number;
  /** At most this many recipes for an ingredient to count as an outlier. */
  outlierMax?: number;
  /** Our ingredient mapping; without it clustering inherits every heuristic miss. */
  aliases?: AliasTable;
}

export function compareRecipes(opts: CompareOptions): Comparison {
  const commonThreshold = opts.commonThreshold ?? 0.6;
  const outlierMax = opts.outlierMax ?? 2;

  const clusters = new Map<number, { description: string; sources: SourceAmount[] }>();
  const unmatched: Comparison["unmatched"] = [];
  let skippedNoServings = 0;
  let analysed = 0;

  for (const recipe of opts.recipes) {
    // Without a servings count there is no per-serving figure, and an absolute
    // mass from an unknown yield would quietly distort every median it joins.
    if (!recipe.servings || recipe.servings <= 0) {
      skippedNoServings++;
      continue;
    }
    analysed++;

    // One line per food per recipe: a recipe listing beef twice (patty and
    // filling) should not count as two recipes using beef.
    const seen = new Set<number>();

    for (const rawLine of recipe.ingredientLines) {
      const parsed = parseIngredientLine(rawLine);
      const result = toGrams({
        quantity: parsed.quantity,
        unit: parsed.unit,
        name: parsed.ingredientName,
        condition: parsed.preparation ?? null,
        db: opts.db,
        aliases: opts.aliases ?? EMPTY_TABLE,
      });

      if (result.grams === null || result.fdcId === null) {
        unmatched.push({ siteName: recipe.provenance.siteName, rawLine, basis: result.basis });
        continue;
      }
      if (seen.has(result.fdcId)) continue;
      seen.add(result.fdcId);

      const entry = clusters.get(result.fdcId) ?? {
        description: result.foodDescription ?? `fdc ${result.fdcId}`,
        sources: [],
      };
      entry.sources.push({
        siteName: recipe.provenance.siteName,
        sourceUrl: recipe.provenance.sourceUrl,
        rawLine,
        grams: result.grams,
        gramsPerServing: round(result.grams / recipe.servings),
        basis: result.basis,
      });
      clusters.set(result.fdcId, entry);
    }
  }

  const all: IngredientCluster[] = [...clusters.entries()].map(([fdcId, entry]) => {
    const grams = entry.sources.map((s) => s.grams);
    const perServing = entry.sources
      .map((s) => s.gramsPerServing)
      .filter((n): n is number => n !== null);

    const medianPerServing = perServing.length > 0 ? round(median(perServing)) : null;
    const lo = perServing.length > 0 ? Math.min(...perServing) : null;
    const hi = perServing.length > 0 ? Math.max(...perServing) : null;

    return {
      fdcId,
      foodDescription: entry.description,
      recipeCount: entry.sources.length,
      frequency: analysed > 0 ? round(entry.sources.length / analysed, 2) : 0,
      medianGrams: round(median(grams)),
      minGrams: round(Math.min(...grams)),
      maxGrams: round(Math.max(...grams)),
      medianPerServing,
      // Guarded against a zero low end, which would make the ratio infinite.
      spread: lo !== null && hi !== null && lo > 0 ? round(hi / lo, 1) : null,
      sources: entry.sources.sort((a, b) => b.gramsPerServing! - a.gramsPerServing!),
    };
  });

  return {
    dish: opts.recipes[0]?.dish ?? "",
    analysed,
    skippedNoServings,
    commonThreshold,
    common: all
      .filter((c) => c.frequency >= commonThreshold)
      .sort((a, b) => b.frequency - a.frequency || b.medianPerServing! - a.medianPerServing!),
    outliers: all
      .filter((c) => c.recipeCount <= outlierMax)
      .sort((a, b) => a.recipeCount - b.recipeCount || b.medianPerServing! - a.medianPerServing!),
    unmatched,
  };
}
