/**
 * Extract a recipe from a fetched page.
 *
 * Tier one of the industry-standard cascade: schema.org Recipe in JSON-LD,
 * which resolves roughly 70% of pages and did resolve 5 of the 6 reachable
 * meatloaf pages. Microdata, heuristic HTML and an LLM fallback are the later
 * tiers and are not implemented yet — a page this cannot read returns a reason
 * rather than a half-filled recipe.
 *
 * Nothing here decides whether a page *may* be fetched. That is the fetcher's
 * job, using the curated list; by the time HTML reaches this module the
 * permission question is already settled and is recorded on the provenance.
 */

import {
  cleanText,
  countSteps,
  ingredientLines,
  parseAuthor,
  parseDuration,
  parseYield,
} from "./normalize";
import { canonicalHost } from "./site-registry";
import {
  assertProvenance,
  type CaptureMethod,
  type ExtractedRecipe,
  type Provenance,
} from "../types/provenance";
import type { Acquisition } from "./curated-sources";

export type ExtractFailure =
  /** No <script type="application/ld+json"> on the page at all. */
  | "no-json-ld"
  /** JSON-LD present, but no Recipe node in it (Paula Deen's case). */
  | "no-recipe-node"
  /** Every JSON-LD block failed to parse (Paula Deen had one of these too). */
  | "unparseable-json-ld"
  /** A Recipe node with no ingredients is not a usable recipe. */
  | "no-ingredients";

export type ExtractResult =
  | { ok: true; recipe: ExtractedRecipe; warnings: string[] }
  | { ok: false; reason: ExtractFailure; blocks: number };

/**
 * Walk any JSON-LD shape looking for a Recipe node.
 *
 * Must handle `@graph` wrappers: 4 of 10 pages measured put the Recipe inside a
 * `@graph` array beside WebPage/Article/Person nodes, where a naive
 * `data["@type"] === "Recipe"` check finds nothing. Yoast emits this by default.
 */
export function findRecipeNode(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 8 || node === null || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findRecipeNode(child, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("Recipe")) return obj;

  // @graph first, then any other nested object — some publishers nest a Recipe
  // under mainEntity or mainEntityOfPage rather than in a graph.
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement"]) {
    const hit = findRecipeNode(obj[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Pull every JSON-LD block out of an HTML document. */
export function jsonLdBlocks(html: string): string[] {
  return [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].map((m) => m[1]!);
}

export interface ExtractOptions {
  html: string;
  sourceUrl: string;
  /** Publication name for the credit line. */
  siteName: string;
  /** The permission basis in force at capture, recorded on the recipe. */
  acquisition: Acquisition;
  /** The dish searched for, e.g. "meatloaf". */
  dish: string;
  method?: CaptureMethod;
  licence?: string | null;
  capturedAt?: string;
}

/**
 * Parse a page into a recipe, or say why it could not be done.
 *
 * Warnings are for fields that were absent rather than wrong — a recipe missing
 * `totalTime` is still worth keeping, and the warning surfaces how often that
 * happens across the corpus.
 */
export function extractRecipe(opts: ExtractOptions): ExtractResult {
  const blocks = jsonLdBlocks(opts.html);
  if (blocks.length === 0) return { ok: false, reason: "no-json-ld", blocks: 0 };

  let node: Record<string, unknown> | null = null;
  let parsed = 0;

  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block);
    } catch {
      // Paula Deen ships two blocks, one of them malformed. One bad block must
      // not cost us a good one, so keep going rather than aborting the page.
      continue;
    }
    parsed++;
    node = findRecipeNode(data);
    if (node) break;
  }

  if (parsed === 0) return { ok: false, reason: "unparseable-json-ld", blocks: blocks.length };
  if (!node) return { ok: false, reason: "no-recipe-node", blocks: blocks.length };

  const lines = ingredientLines(node.recipeIngredient ?? node.ingredients);
  if (lines.length === 0) return { ok: false, reason: "no-ingredients", blocks: blocks.length };

  const yielded = parseYield(node.recipeYield);
  const totalRaw = cleanText(node.totalTime) ?? null;
  const total = parseDuration(node.totalTime);
  const prep = parseDuration(node.prepTime);
  const cook = parseDuration(node.cookTime);

  const provenance: Provenance = {
    host: canonicalHost(opts.sourceUrl),
    siteName: opts.siteName,
    sourceUrl: opts.sourceUrl,
    author: parseAuthor(node.author),
    sourceTitle: cleanText(node.name) ?? opts.dish,
    capturedAt: opts.capturedAt ?? new Date().toISOString().slice(0, 10),
    method: opts.method ?? "structured-data",
    acquisitionAtCapture: opts.acquisition,
    licence: opts.licence ?? null,
  };
  // Throws rather than returning a failure: a recipe that reached this point but
  // cannot be attributed is a bug in the caller, not a property of the page.
  assertProvenance(provenance);

  const warnings: string[] = [];
  if (!yielded) warnings.push("no recipeYield");
  if (total === null) warnings.push("no usable totalTime");
  if (total === null && prep !== null && cook !== null) {
    warnings.push("totalTime derived from prepTime + cookTime");
  }
  if (!provenance.author) warnings.push("no author named");
  if (blocks.length > parsed) warnings.push(`${blocks.length - parsed} unparseable JSON-LD block(s)`);

  return {
    ok: true,
    warnings,
    recipe: {
      id: `${provenance.host}:${opts.dish}:${provenance.capturedAt}`,
      provenance,
      dish: opts.dish,
      ingredientLines: lines,
      servings: yielded?.servings ?? null,
      servingsRaw: yielded?.raw ?? null,
      // Falling back to prep + cook is stated in the warnings, never silent.
      totalTimeMinutes: total ?? (prep !== null && cook !== null ? prep + cook : null),
      prepTimeMinutes: prep,
      cookTimeMinutes: cook,
      totalTimeRaw: totalRaw,
      stepCount: countSteps(node.recipeInstructions),
    },
  };
}
