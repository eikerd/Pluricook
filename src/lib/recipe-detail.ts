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
  /** Its % of everything the recipe lists in grams, or null when not counted. */
  share: number | null;
  /** The USDA record it matched, or null. */
  food: string | null;
  /** Set when the line leaned on not-in-usda.json: "not in USDA", "fresh, counted as dry ×0.77". */
  workaround: string | null;
  /** How the parser read the line — where a gotcha shows itself. */
  read: { quantity: number; unit: string; name: string; statedGrams: number | null };
}

export interface RecipeFacts {
  servings: number | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
}

export interface RecipeDetail {
  recipeId: string;
  siteName: string;
  sourceTitle: string;
  author: string | null;
  sourceUrl: string | null;
  facts: RecipeFacts;
  /** Everything the recipe lists in grams, across all its sections. */
  totalGrams: number;
  /** A recipe the source did not divide is one section with no name. */
  sections: Array<{ name: string | null; lines: DetailLine[] }>;
}

const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

function describeLine(line: string, db: Database, aliases: AliasTable): Omit<DetailLine, "share"> {
  const parsed = parseLine(line);
  const result = toGrams({ ...conversionInput(parsed), name: parsed.name, condition: parsed.preparation, db, aliases });
  // compare.ts drops a line unless it has both grams and an identified food; so do we.
  const counted = result.grams !== null && result.fdcId !== null;
  return {
    line,
    grams: counted ? result.grams : null,
    food: counted ? result.foodDescription : null,
    workaround: counted ? result.workaround : null,
    read: { quantity: parsed.quantity, unit: parsed.unit, name: parsed.name, statedGrams: parsed.statedGrams },
  };
}

/** A recipe's lines as its source grouped them; undivided is one section with no name. */
export function groupsOf(recipe: ExtractedRecipe): Array<{ name: string | null; lines: string[] }> {
  return recipe.sections?.length
    ? recipe.sections.map((s) => ({ name: s.name, lines: s.ingredientLines }))
    : [{ name: null, lines: recipe.ingredientLines }];
}

export function factsOf(recipe: ExtractedRecipe): RecipeFacts {
  return {
    servings: recipe.servings,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    totalTimeMinutes: recipe.totalTimeMinutes,
  };
}

export function describeRecipe(recipe: ExtractedRecipe, db: Database, aliases: AliasTable): RecipeDetail {
  const groups = groupsOf(recipe);

  const described = groups.map((g) => ({ name: g.name, lines: g.lines.map((l) => describeLine(l, db, aliases)) }));
  // Shares are of the whole recipe, so a line reads the same whichever section it sits in.
  const totalGrams = round(described.flatMap((s) => s.lines).reduce((sum, l) => sum + (l.grams ?? 0), 0), 2);
  const shareOf = (grams: number | null) => (grams === null || totalGrams === 0 ? null : round((grams / totalGrams) * 100, 1));

  return {
    recipeId: recipe.id,
    siteName: recipe.provenance.siteName,
    sourceTitle: recipe.provenance.sourceTitle,
    author: recipe.provenance.author,
    sourceUrl: recipe.provenance.sourceUrl,
    facts: factsOf(recipe),
    totalGrams,
    sections: described.map((s) => ({ name: s.name, lines: s.lines.map((l) => ({ ...l, share: shareOf(l.grams) })) })),
  };
}
