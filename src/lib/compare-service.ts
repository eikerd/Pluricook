/**
 * Comparison, served to the admin.
 *
 * Thin on purpose: it finds the recipes for a dish, opens the reference data,
 * and hands everything to compareRecipes. No comparison logic lives here, so
 * the CLI report and the admin can never disagree about a number.
 */

import { Database } from "bun:sqlite";
import { Glob } from "bun";
import { compareRecipes, type Comparison } from "./compare";
import { readAliases } from "./ingredient-aliases";
import type { ExtractedRecipe } from "../types/provenance";

export interface DishSummary {
  dish: string;
  recipes: number;
  /** How many are private — the owner's notes awaiting a source link. */
  privateRecipes: number;
  sections: string[];
}

async function readDish(dish: string): Promise<ExtractedRecipe[] | null> {
  // The dish arrives from a URL; keep it to a plain slug so it cannot name a path.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(dish)) return null;
  const file = Bun.file(`data/recipes/${dish}.json`);
  if (!(await file.exists())) return null;
  return ((await file.json()) as { recipes: ExtractedRecipe[] }).recipes ?? [];
}

export async function listDishes(): Promise<DishSummary[]> {
  const out: DishSummary[] = [];
  for await (const path of new Glob("data/recipes/*.json").scan(".")) {
    const { dish, recipes } = (await Bun.file(path).json()) as {
      dish: string; recipes: ExtractedRecipe[];
    };
    out.push({
      dish,
      recipes: recipes.length,
      privateRecipes: recipes.filter((r) => r.visibility === "private").length,
      sections: [...new Set(recipes.flatMap((r) => (r.sections ?? []).map((s) => s.name)))],
    });
  }
  return out.sort((a, b) => a.dish.localeCompare(b.dish));
}

export type CompareOutcome =
  | { ok: true; comparison: Comparison }
  | { ok: false; status: number; error: string };

export async function compareDish(dish: string, section: string | null): Promise<CompareOutcome> {
  const recipes = await readDish(dish);
  if (recipes === null) return { ok: false, status: 404, error: `No recipes captured for "${dish}".` };

  let db: Database;
  try {
    db = new Database("usda.db", { readonly: true });
  } catch {
    return { ok: false, status: 503, error: "usda.db has not been built — run bun scripts/build-usda-db.ts" };
  }

  try {
    const comparison = compareRecipes({ recipes, db, aliases: await readAliases(), section });
    return { ok: true, comparison };
  } finally {
    db.close();
  }
}
