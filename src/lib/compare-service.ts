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
import { describeRecipe, type RecipeDetail } from "./recipe-detail";
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

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * What a recipe entry must have before anything here reads it. Checking only
 * the outer array let valid JSON with a malformed entry — `recipes: [null]`, a
 * `sections` that is a string — through, to throw later outside every guard.
 * Returns why an entry is unusable, or null when it is fine.
 */
function entryProblem(entry: unknown): string | null {
  if (!isObject(entry)) return "is not an object";
  if (typeof entry.id !== "string" || entry.id === "") return "has no id";
  // compareRecipes names every row by its source; a recipe without one is not
  // comparable, and would throw only once someone opened that dish.
  const p = entry.provenance;
  if (!isObject(p) || typeof p.siteName !== "string") return "has no provenance.siteName";
  if (p.sourceUrl !== null && p.sourceUrl !== undefined && typeof p.sourceUrl !== "string") return "has a sourceUrl that is not text";
  if (entry.servings != null && typeof entry.servings !== "number") return "has servings that are not a number";
  if (!isStringArray(entry.ingredientLines)) return "has no ingredientLines list of strings";
  if (entry.sections === undefined) return null;
  if (!Array.isArray(entry.sections)) return "has sections that are not a list";
  const bad = entry.sections.findIndex(
    (s) => !isObject(s) || typeof s.name !== "string" || !isStringArray(s.ingredientLines),
  );
  return bad === -1 ? null : `has a malformed section at index ${bad}`;
}

async function readRecipes(path: string): Promise<ExtractedRecipe[]> {
  const parsed: unknown = await Bun.file(path).json();
  if (!isObject(parsed) || !Array.isArray(parsed.recipes)) {
    throw new Error(`${path} has no "recipes" array`);
  }
  parsed.recipes.forEach((entry, i) => {
    const problem = entryProblem(entry);
    if (problem) throw new Error(`${path}: recipe ${i} ${problem}`);
  });
  return parsed.recipes as ExtractedRecipe[];
}

function summarize(dish: string, recipes: ExtractedRecipe[]): DishSummary {
  return {
    dish,
    recipes: recipes.length,
    privateRecipes: recipes.filter((r) => r.visibility === "private").length,
    sections: [...new Set(recipes.flatMap((r) => (r.sections ?? []).map((s) => s.name)))],
  };
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

    // These files are edited by hand. One stray comma — or one malformed entry
    // in valid JSON — should cost one dish, not the whole picker, and the log
    // should say which file. Everything that reads the file sits inside this guard.
    try {
      out.push(summarize(dish, await readRecipes(path)));
    } catch (error) {
      console.error(`[compare-service] skipped ${path}:`, error);
    }
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
    // compareRecipes names the dish from the first recipe's own field. Here the
    // filename is the identifier, so the answer is named by what was asked for —
    // otherwise a copied file answers under its original's name, and an empty
    // file under none at all.
    return { ok: true, comparison: { ...comparison, dish } };
  } catch (error) {
    // Answer in the API's own shape; an uncaught throw becomes Bun's plain-text 500.
    console.error(`[compare-service] comparison failed for "${dish}":`, error);
    return { ok: false, status: 500, error: `Comparing "${dish}" failed. See the server log.` };
  } finally {
    db.close();
  }
}

export type DetailOutcome =
  | { ok: true; detail: RecipeDetail }
  | { ok: false; status: number; error: string };

/**
 * One recipe of a dish, line by line. The id only selects among the dish's own
 * recipes — it never reaches a path — so it may hold the colons and dots every
 * captured id has.
 */
export async function recipeDetail(dish: string, recipeId: string): Promise<DetailOutcome> {
  let recipes: ExtractedRecipe[] | null;
  try {
    recipes = await readDish(dish);
  } catch (error) {
    console.error(`[compare-service] could not read "${dish}":`, error);
    return { ok: false, status: 500, error: `The recipe file for "${dish}" could not be read. See the server log.` };
  }
  if (recipes === null) return { ok: false, status: 404, error: `No recipes captured for "${dish}".` };

  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe) return { ok: false, status: 404, error: `"${dish}" holds no recipe "${recipeId}".` };

  let db: Database;
  try {
    db = new Database("usda.db", { readonly: true });
  } catch {
    return { ok: false, status: 503, error: "usda.db has not been built — run bun scripts/build-usda-db.ts" };
  }

  try {
    return { ok: true, detail: describeRecipe(recipe, db, await readAliases()) };
  } catch (error) {
    console.error(`[compare-service] describing "${recipeId}" failed:`, error);
    return { ok: false, status: 500, error: `Reading "${recipeId}" failed. See the server log.` };
  } finally {
    db.close();
  }
}
