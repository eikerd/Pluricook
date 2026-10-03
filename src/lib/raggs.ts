/**
 * RAGGs — recipe aggregates. A RAGG is what someone searched for (lentil soup,
 * Detroit pizza) and the sourced recipes we gathered for it: the app's top
 * level. Each one is a file, data/recipes/<slug>.json, and its slug is its name.
 *
 * The figures here come from the same comparison the RAGG's page draws, so the
 * list and the page can never disagree about which ingredients are common.
 */

import { Glob } from "bun";
import { compareDish, readDish } from "./compare-service";
import type { IngredientCluster } from "./compare";
import type { ExtractedRecipe } from "../types/provenance";

const RECIPES_DIR = "data/recipes";
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const TOP_INGREDIENTS = 3;

export interface RaggSummary {
  slug: string;
  /** "detroit-pizza" → "Detroit pizza". */
  name: string;
  /** When its recipes were gathered: the file's extractedAt, else its earliest capture. */
  created: string | null;
  recipes: number;
  /** Distinct websites the recipes come from; the owner's own copies have none. */
  sites: number;
  /** The ingredients the most recipes share, most shared first. */
  topIngredients: string[];
}

/** One constituent recipe, as a row of the RAGG's page. */
export interface RaggRecipe {
  id: string;
  site: string;
  host: string | null;
  title: string;
  author: string | null;
  url: string | null;
  servings: number | null;
  minutes: number | null;
  lines: number;
  capturedAt: string;
}

export interface RaggPage {
  summary: RaggSummary;
  recipes: RaggRecipe[];
}

export type RaggOutcome = { ok: true; page: RaggPage } | { ok: false; status: number; error: string };

export const raggName = (slug: string) => {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const slugOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");

/** Most recipes first; the heavier ingredient breaks a tie, then the name. */
function topIngredients(clusters: IngredientCluster[]): string[] {
  return [...clusters]
    .sort((a, b) => b.recipeCount - a.recipeCount || b.medianGrams - a.medianGrams
      || a.foodDescription.localeCompare(b.foodDescription))
    .slice(0, TOP_INGREDIENTS)
    .map((c) => c.foodDescription);
}

async function createdOf(slug: string, recipes: ExtractedRecipe[]): Promise<string | null> {
  const file = (await Bun.file(`${RECIPES_DIR}/${slug}.json`).json()) as { extractedAt?: unknown };
  if (typeof file.extractedAt === "string") return file.extractedAt;
  const dates = recipes.map((r) => r.provenance.capturedAt).filter(Boolean).sort();
  return dates[0] ?? null;
}

type Built = { summary: RaggSummary; recipes: ExtractedRecipe[] };

async function build(slug: string): Promise<Built | null> {
  const recipes = await readDish(slug);
  if (recipes === null) return null;
  const outcome = await compareDish(slug, null);
  const clusters = outcome.ok
    ? [...outcome.comparison.common, ...outcome.comparison.occasional, ...outcome.comparison.outliers]
    : [];
  const hosts = new Set(recipes.map((r) => r.provenance.host).filter((h): h is string => Boolean(h)));
  return {
    summary: {
      slug,
      name: raggName(slug),
      created: await createdOf(slug, recipes),
      recipes: recipes.length,
      sites: hosts.size,
      topIngredients: topIngredients(clusters),
    },
    recipes,
  };
}

/** Every RAGG, newest first. One unreadable file costs its own row, and the log names it. */
export async function listRaggs(): Promise<RaggSummary[]> {
  const out: RaggSummary[] = [];
  for await (const path of new Glob(`${RECIPES_DIR}/*.json`).scan(".")) {
    const slug = slugOf(path);
    if (!SLUG.test(slug)) continue;
    try {
      const built = await build(slug);
      if (built) out.push(built.summary);
    } catch (error) {
      console.error(`[raggs] skipped ${path}:`, error);
    }
  }
  return out.sort((a, b) => (b.created ?? "").localeCompare(a.created ?? "") || a.name.localeCompare(b.name));
}

/**
 * One RAGG and its constituent recipes. A file edited by hand into something
 * unreadable is a failure that names the RAGG, in the API's own shape, as
 * compareDish answers — never a throw out of the route.
 */
export async function raggPage(slug: string): Promise<RaggOutcome> {
  const notFound: RaggOutcome = { ok: false, status: 404, error: `No RAGG "${slug}".` };
  if (!SLUG.test(slug)) return notFound;
  let built: Built | null;
  try {
    built = await build(slug);
  } catch (error) {
    console.error(`[raggs] could not read "${slug}":`, error);
    return { ok: false, status: 500, error: `The recipe file for "${slug}" could not be read. See the server log.` };
  }
  if (!built) return notFound;
  return { ok: true, page: {
    summary: built.summary,
    recipes: built.recipes.map((r) => ({
      id: r.id,
      site: r.provenance.siteName,
      host: r.provenance.host,
      title: r.provenance.sourceTitle,
      author: r.provenance.author,
      url: r.provenance.sourceUrl,
      servings: r.servings ?? null,
      minutes: r.totalTimeMinutes ?? null,
      lines: r.ingredientLines.length,
      capturedAt: r.provenance.capturedAt,
    })),
  } };
}
