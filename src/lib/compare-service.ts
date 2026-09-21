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

const RECIPES_DIR = "data/recipes";
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A dish IS its filename. The files also carry a `dish` field, but the compare
 * route opens a file by name, so a second identifier could only ever disagree
 * with it — a copied file would list under one name and be unreachable by it.
 */
const slugOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");

async function readRecipes(path: string): Promise<ExtractedRecipe[]> {
  const parsed = (await Bun.file(path).json()) as { recipes?: unknown };
  if (!Array.isArray(parsed.recipes)) throw new Error(`${path} has no "recipes" array`);
  return parsed.recipes as ExtractedRecipe[];
}

async function readDish(dish: string): Promise<ExtractedRecipe[] | null> {
  // The dish arrives from a URL; keep it to a plain slug so it cannot name a path.
  if (!SLUG.test(dish)) return null;
  const path = `${RECIPES_DIR}/${dish}.json`;
  if (!(await Bun.file(path).exists())) return null;
  return readRecipes(path);
}

export async function listDishes(): Promise<DishSummary[]> {
  const out: DishSummary[] = [];
  for await (const path of new Glob(`${RECIPES_DIR}/*.json`).scan(".")) {
    const dish = slugOf(path);
    if (!SLUG.test(dish)) continue;   // the compare route could never open it

    // These files are edited by hand. One stray comma should cost one dish,
    // not the whole picker — and the log should say which file.
    let recipes: ExtractedRecipe[];
    try {
      recipes = await readRecipes(path);
    } catch (error) {
      console.error(`[compare-service] skipped ${path}:`, error);
      continue;
    }

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
  let recipes: ExtractedRecipe[] | null;
  try {
    recipes = await readDish(dish);
  } catch (error) {
    console.error(`[compare-service] could not read "${dish}":`, error);
    return { ok: false, status: 500, error: `The recipe file for "${dish}" could not be read. See the server log.` };
  }
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
  } catch (error) {
    // Answer in the API's own shape; an uncaught throw becomes Bun's plain-text 500.
    console.error(`[compare-service] comparison failed for "${dish}":`, error);
    return { ok: false, status: 500, error: `Comparing "${dish}" failed. See the server log.` };
  } finally {
    db.close();
  }
}
