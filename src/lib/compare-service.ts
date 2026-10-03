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
import { makeClone, ownersView, readClones, writeClones } from "./clones";
import { applyCorrections, readCorrections, removeCorrection, validateCorrection, writeCorrection, type RecipeCorrection } from "./corrections";
import { readAliases } from "./ingredient-aliases";
import { readEquivalents } from "./equivalents";
import { describeRecipe, factsOf, groupsOf, type RecipeDetail, type RecipeFacts } from "./recipe-detail";
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

export async function readDish(dish: string): Promise<ExtractedRecipe[] | null> {
  // The dish arrives from a URL; keep it to a plain slug so it cannot name a path.
  if (!SLUG.test(dish)) return null;
  const path = `${RECIPES_DIR}/${dish}.json`;
  if (!(await Bun.file(path).exists())) return null;
  // The comparison, and every chart drawn from it, reads the dish as the owner
  // has it: corrections applied, their own copies beside the originals.
  return ownersView(dish, await readRecipes(path));
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
      // As the owner has it, so a section they renamed is offered under its new name.
      out.push(summarize(dish, await ownersView(dish, await readRecipes(path))));
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
    const comparison = compareRecipes({ recipes, db, aliases: await readAliases(), equivalents: await readEquivalents(), section });
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

/** Everything the recipe page shows. */
export interface RecipePageData {
  dish: string;
  /** As the comparison uses it: the owner's correction applied. */
  detail: RecipeDetail;
  /** As captured, to show beside a correction. */
  published: {
    sourceTitle: string;
    author: string | null;
    sourceUrl: string | null;
    facts: RecipeFacts;
    sections: Array<{ name: string | null; lines: string[] }>;
  };
  correction: RecipeCorrection | null;
  /**
   * Null for a captured recipe. For the owner's own copy, what it began as —
   * the original's name is null if that recipe is no longer captured.
   */
  copy: { clonedFrom: string | null; originalSiteName: string | null } | null;
}

type Failure = { ok: false; status: number; error: string };
export type PageOutcome = { ok: true; page: RecipePageData } | Failure;

const CLONES_DIR = "data/clones";
const today = () => new Date().toISOString().slice(0, 10);
const notFound = (id: string): Failure => ({ ok: false, status: 404, error: `No recipe has the id "${id}".` });

/**
 * Which dish holds a recipe, by id alone — a recipe's page is addressed by its
 * id, /recipes/<id> — and whether it is the owner's own copy. The dish is then
 * a file's own slug, never text from the request, so it is safe to build the
 * corrections and clones paths from.
 */
async function findRecipe(id: string): Promise<{ dish: string; recipe: ExtractedRecipe; isCopy: boolean } | null> {
  const scan = async (dir: string, isCopy: boolean) => {
    for await (const path of new Glob(`${dir}/*.json`).scan(".")) {
      const dish = slugOf(path);
      if (!SLUG.test(dish)) continue;
      let recipes: ExtractedRecipe[];
      try {
        recipes = await readRecipes(path);
      } catch {
        continue;   // one broken file costs its own recipes, as in listDishes
      }
      const recipe = recipes.find((r) => r.id === id);
      if (recipe) return { dish, recipe, isCopy };
    }
    return null;
  };
  return (await scan(RECIPES_DIR, false)) ?? (await scan(CLONES_DIR, true));
}

export async function recipePage(id: string): Promise<PageOutcome> {
  const found = await findRecipe(id);
  if (!found) return notFound(id);
  const { dish, recipe, isCopy } = found;
  // A copy is edited directly, so only a captured recipe has a correction.
  const correction = isCopy ? null : ((await readCorrections(dish))[id] ?? null);
  const [corrected] = applyCorrections([recipe], correction ? { [id]: correction } : {});
  const original = isCopy && recipe.clonedFrom ? await findRecipe(recipe.clonedFrom) : null;
  const copy = isCopy
    ? { clonedFrom: recipe.clonedFrom ?? null, originalSiteName: original?.recipe.provenance.siteName ?? null }
    : null;

  let db: Database;
  try {
    db = new Database("usda.db", { readonly: true });
  } catch {
    return { ok: false, status: 503, error: "usda.db has not been built — run bun scripts/build-usda-db.ts" };
  }

  try {
    return {
      ok: true,
      page: {
        dish,
        detail: describeRecipe(corrected!, db, await readAliases()),
        published: {
          sourceTitle: recipe.provenance.sourceTitle,
          author: recipe.provenance.author,
          sourceUrl: recipe.provenance.sourceUrl,
          facts: factsOf(recipe),
          sections: groupsOf(recipe),
        },
        correction,
        copy,
      },
    };
  } catch (error) {
    console.error(`[compare-service] describing "${id}" failed:`, error);
    return { ok: false, status: 500, error: `Reading "${id}" failed. See the server log.` };
  } finally {
    db.close();
  }
}

/**
 * Save the owner's edit. For a captured recipe it is a correction beside the
 * published one; for the owner's own copy, which has nothing to preserve, the
 * edit is written into the copy itself.
 */
export async function saveCorrection(id: string, body: unknown): Promise<PageOutcome> {
  const found = await findRecipe(id);
  if (!found) return notFound(id);
  const valid = validateCorrection(body);
  if (!valid.ok) return { ok: false, status: 400, error: valid.error };
  try {
    if (found.isCopy) {
      const [edited] = applyCorrections([found.recipe], { [id]: valid.correction });
      const clones = await readClones(found.dish);
      await writeClones(found.dish, clones.map((c) => (c.id === id ? edited! : c)));
    } else {
      await writeCorrection(found.dish, id, valid.correction);
    }
  } catch (error) {
    console.error(`[compare-service] could not save the edit to "${id}":`, error);
    return { ok: false, status: 500, error: "The edit could not be saved. See the server log." };
  }
  return recipePage(id);
}

/** Drop the owner's correction; the recipe reads as published again. */
export async function revertCorrection(id: string): Promise<PageOutcome> {
  const found = await findRecipe(id);
  if (!found) return notFound(id);
  if (found.isCopy) return { ok: false, status: 400, error: "Your own copy has no published version to go back to." };
  try {
    await removeCorrection(found.dish, id);
  } catch (error) {
    console.error(`[compare-service] could not remove the correction to "${id}":`, error);
    return { ok: false, status: 500, error: "The correction could not be removed. See the server log." };
  }
  return recipePage(id);
}

/**
 * Make the owner their own copy of a recipe, to develop. It copies what they
 * see — a captured recipe with its correction applied — and joins the dish
 * beside the original.
 */
export async function cloneRecipe(id: string): Promise<{ ok: true; id: string } | Failure> {
  const found = await findRecipe(id);
  if (!found) return notFound(id);
  const { dish, recipe, isCopy } = found;
  try {
    const [source] = isCopy ? [recipe] : applyCorrections([recipe], await readCorrections(dish));
    const clones = await readClones(dish);
    const captured = await readRecipes(`${RECIPES_DIR}/${dish}.json`);
    const clone = makeClone(source!, dish, new Set([...captured, ...clones].map((r) => r.id)), today());
    await writeClones(dish, [...clones, clone]);
    return { ok: true, id: clone.id };
  } catch (error) {
    console.error(`[compare-service] could not copy "${id}":`, error);
    return { ok: false, status: 500, error: "The copy could not be made. See the server log." };
  }
}

/** Delete one of the owner's copies. A captured recipe cannot be deleted from here. */
export async function deleteClone(id: string): Promise<{ ok: true } | Failure> {
  const found = await findRecipe(id);
  if (!found) return notFound(id);
  if (!found.isCopy) return { ok: false, status: 400, error: "Only your own copies can be deleted; a captured recipe stays." };
  try {
    await writeClones(found.dish, (await readClones(found.dish)).filter((c) => c.id !== id));
    return { ok: true };
  } catch (error) {
    console.error(`[compare-service] could not delete "${id}":`, error);
    return { ok: false, status: 500, error: "The copy could not be deleted. See the server log." };
  }
}
