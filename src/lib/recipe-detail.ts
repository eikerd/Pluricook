/**
 * One recipe, line by line, as the comparison reads it: every line as
 * published, grouped the way the source grouped it, with the grams it came to
 * and the USDA food it matched.
 *
 * Each line takes the path compare.ts takes — parseLine, conversionInput,
 * toGrams — and counts only when the comparison would count it, so the detail
 * view and the charts cannot disagree about a single line.
 */

import type { Database } from "bun:sqlite";
import type { AliasTable } from "./ingredient-aliases";
import { conversionInput, parseLine } from "./ingredient-line";
import { toGrams } from "./to-grams";
import type { ExtractedRecipe } from "../types/provenance";

export interface DetailLine {
  /** The line as published. */
  line: string;
  /** What it came to, or null when the comparison could not use it. */
  grams: number | null;
  /** The USDA record it matched, or null. */
  food: string | null;
}

export interface RecipeDetail {
  recipeId: string;
  siteName: string;
  sourceTitle: string;
  author: string | null;
  sourceUrl: string | null;
  /** A recipe the source did not divide is one section with no name. */
  sections: Array<{ name: string | null; lines: DetailLine[] }>;
}

function describeLine(line: string, db: Database, aliases: AliasTable): DetailLine {
  const parsed = parseLine(line);
  const result = toGrams({ ...conversionInput(parsed), name: parsed.name, condition: parsed.preparation, db, aliases });
  // compare.ts drops a line unless it has both grams and an identified food; so do we.
  const counted = result.grams !== null && result.fdcId !== null;
  return { line, grams: counted ? result.grams : null, food: counted ? result.foodDescription : null };
}

export function describeRecipe(recipe: ExtractedRecipe, db: Database, aliases: AliasTable): RecipeDetail {
  const groups = recipe.sections?.length
    ? recipe.sections.map((s) => ({ name: s.name as string | null, lines: s.ingredientLines }))
    : [{ name: null, lines: recipe.ingredientLines }];

  return {
    recipeId: recipe.id,
    siteName: recipe.provenance.siteName,
    sourceTitle: recipe.provenance.sourceTitle,
    author: recipe.provenance.author,
    sourceUrl: recipe.provenance.sourceUrl,
    sections: groups.map((g) => ({ name: g.name, lines: g.lines.map((l) => describeLine(l, db, aliases)) })),
  };
}
