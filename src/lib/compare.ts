/**
 * Consensus and variation across the recipes captured for one dish.
 *
 * Ingredients are clustered by USDA `fdc_id`: the gram conversion already
 * resolved each line to a food record, so that identifier is a free, natural
 * key. The cost is that clustering inherits the matcher's mistakes, which is
 * why misses are surfaced in `unmatched` and pinned in the regression fixture.
 *
 * Amounts are stated against the dish's ANCHOR (see anchor.ts) — meat for a
 * meat dish, flour for a baked one, legumes for a dal, and so on down to a
 * centered log-ratio when nothing is shared. Per-serving figures are kept as a
 * secondary view, but a recipe no longer needs a servings count to take part:
 * "a serving" is an author's opinion, and the corpus shows it varying 2.2x.
 *
 * Each recipe also gets a salinity reading — total sodium from the USDA
 * nutrient table, as salt-equivalent against the anchor. It serves two jobs at
 * once: a health figure, and a sanity check, because a recipe whose salinity is
 * far off its peers usually has a parsing error rather than a bold cook.
 */

import type { Database } from "bun:sqlite";
import {
  chooseAnchor,
  classMass,
  classifyCategory,
  relativeAmount,
  type AnchorDecision,
  type AnchorOptions,
  type Composition,
  type FoodClass,
} from "./anchor";
import { parseLine } from "./ingredient-line";
import { EMPTY_TABLE, type AliasTable } from "./ingredient-aliases";
import { toGrams, type Basis } from "./to-grams";
import type { ExtractedRecipe } from "../types/provenance";

/** NaCl / Na mass ratio: sodium × 2.54 = its table-salt equivalent. */
const NA_TO_NACL = 2.54;
/** FDA daily value for sodium, mg. */
const SODIUM_DAILY_VALUE_MG = 2300;

export interface SourceAmount {
  siteName: string;
  sourceUrl: string | null;
  /** The line exactly as published, so a surprising number can be checked. */
  rawLine: string;
  grams: number;
  /** Amount against the dish anchor, in `Comparison.anchor.unitLabel`. */
  relative: number | null;
  gramsPerServing: number | null;
  basis: Basis;
}

export interface IngredientCluster {
  fdcId: number;
  foodDescription: string;
  klass: FoodClass;
  /** True when this cluster belongs to the anchor class itself. */
  isAnchor: boolean;
  recipeCount: number;
  frequency: number;
  medianGrams: number;
  medianRelative: number | null;
  /** max / min of relative amounts — how far the corpus disagrees. */
  spreadRelative: number | null;
  medianPerServing: number | null;
  sources: SourceAmount[];
}

export type SalinityFlag =
  | "ok"
  /** More than twice the corpus median. */
  | "high"
  /** Under half the corpus median. */
  | "low"
  /** Too few lines resolved for the total to mean much. */
  | "unreliable";

export interface RecipeSummary {
  siteName: string;
  sourceUrl: string | null;
  servings: number | null;
  resolvedLines: number;
  totalLines: number;
  /** Mass of the anchor class in this recipe, grams. Null under clr. */
  anchorGrams: number | null;
  sodiumMg: number;
  saltEquivalentGrams: number;
  /** Salt-equivalent against the anchor, in the anchor's unit. */
  salinityRelative: number | null;
  sodiumMgPerServing: number | null;
  /** Share of the FDA daily value in one serving, 0–1+. */
  sodiumDailyValueShare: number | null;
  salinityFlag: SalinityFlag;
}

export interface Comparison {
  dish: string;
  /** The section compared, or null for whole recipes. */
  section: string | null;
  /** Every section name found across the dish's recipes, in first-seen order. */
  sectionsAvailable: string[];
  analysed: number;
  anchor: AnchorDecision;
  /** Recipes in which the anchor class was actually present. */
  withAnchor: number;
  commonThreshold: number;
  common: IngredientCluster[];
  outliers: IngredientCluster[];
  recipes: RecipeSummary[];
  /** Corpus median salinity, for judging any one recipe against. */
  medianSalinity: number | null;
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
  commonThreshold?: number;
  outlierMax?: number;
  aliases?: AliasTable;
  anchor?: AnchorOptions;
  /** Below this share of resolved lines, a salinity total is not trusted. */
  minResolvedShare?: number;
  /**
   * Compare one named section only — "dough", "sauce".
   *
   * A pizza's dough salt and sauce salt are different questions. Summed, they
   * produce a "salt % of flour" that is neither: only the dough's salt is
   * meaningful against flour, which is what a baker's percentage IS. With a
   * section named, each section also gets its own anchor — flour for the dough,
   * tomato for the sauce — because the anchor is chosen from the lines compared.
   * Recipes that do not carry the section take no part.
   */
  section?: string | null;
}

interface ResolvedPart {
  rawLine: string;
  fdcId: number;
  grams: number;
  basis: Basis;
  description: string;
  klass: FoodClass;
}

export function compareRecipes(opts: CompareOptions): Comparison {
  const commonThreshold = opts.commonThreshold ?? 0.6;
  const outlierMax = opts.outlierMax ?? 2;
  const minResolvedShare = opts.minResolvedShare ?? 0.6;

  const categoryOf = opts.db.query<{ category_id: number | null }, [number]>(
    `SELECT category_id FROM foods WHERE fdc_id = ?1`,
  );
  const sodiumOf = opts.db.query<{ amount: number | null }, [number]>(
    `SELECT fn.amount FROM food_nutrients fn JOIN nutrients n ON n.id = fn.nutrient_id
     WHERE fn.fdc_id = ?1 AND n.name = 'Sodium, Na' LIMIT 1`,
  );

  const unmatched: Comparison["unmatched"] = [];

  const section = opts.section ?? null;
  const sectionsAvailable = [
    ...new Set(opts.recipes.flatMap((r) => (r.sections ?? []).map((x) => x.name))),
  ];

  // Whole recipes by default; one section's lines when a section is named.
  const inScope = opts.recipes
    .map((recipe) => ({
      recipe,
      lines: section
        ? (recipe.sections?.find((x) => x.name === section)?.ingredientLines ?? null)
        : recipe.ingredientLines,
    }))
    .filter((x): x is { recipe: ExtractedRecipe; lines: string[] } => x.lines !== null);

  // ── Pass 1: resolve every line of every recipe ──────────────────────────
  const resolved = inScope.map(({ recipe, lines }) => {
    const parts: ResolvedPart[] = [];
    let sodiumMg = 0;

    for (const rawLine of lines) {
      const parsed = parseLine(rawLine);
      const result = toGrams({
        quantity: parsed.quantity,
        unit: parsed.unit,
        name: parsed.name,
        condition: parsed.preparation,
        db: opts.db,
        aliases: opts.aliases ?? EMPTY_TABLE,
      });

      if (result.grams === null || result.fdcId === null) {
        unmatched.push({ siteName: recipe.provenance.siteName, rawLine, basis: result.basis });
        continue;
      }

      // USDA nutrient amounts are per 100 g of the food.
      sodiumMg += ((sodiumOf.get(result.fdcId)?.amount ?? 0) * result.grams) / 100;

      parts.push({
        rawLine,
        fdcId: result.fdcId,
        grams: result.grams,
        basis: result.basis,
        description: result.foodDescription ?? `fdc ${result.fdcId}`,
        klass: classifyCategory(categoryOf.get(result.fdcId)?.category_id ?? null),
      });
    }

    const composition: Composition = {
      recipeId: recipe.id,
      parts: parts.map((p) => ({ klass: p.klass, grams: p.grams })),
    };
    return { recipe, parts, composition, sodiumMg, lineCount: lines.length };
  });

  // ── Pass 2: one anchor for the whole dish ───────────────────────────────
  const anchor = chooseAnchor(resolved.map((r) => r.composition), opts.anchor);
  const anchorKlass = anchor.kind === "class" ? anchor.klass : null;

  // ── Pass 3: cluster, stating every amount against the anchor ────────────
  const clusters = new Map<
    number,
    { description: string; klass: FoodClass; sources: SourceAmount[] }
  >();
  let withAnchor = 0;

  for (const { recipe, parts, composition } of resolved) {
    if (anchorKlass === null || classMass(composition, anchorKlass) > 0) withAnchor++;

    // One SOURCE per food per recipe, so frequency counts recipes, not lines —
    // but its amount is the SUM of every line. Natasha's Kitchen lists ketchup
    // twice (2 Tbsp in the loaf, 3/4 cup in the glaze); keeping only the first
    // understated her ketchup sixfold while the anchor mass still counted both.
    const combined = new Map<number, ResolvedPart & { lines: string[] }>();
    for (const p of parts) {
      const prior = combined.get(p.fdcId);
      if (prior) {
        prior.grams += p.grams;
        prior.lines.push(p.rawLine);
      } else {
        combined.set(p.fdcId, { ...p, lines: [p.rawLine] });
      }
    }

    for (const p of combined.values()) {
      const entry = clusters.get(p.fdcId) ?? {
        description: p.description, klass: p.klass, sources: [],
      };
      const grams = round(p.grams);
      entry.sources.push({
        siteName: recipe.provenance.siteName,
        sourceUrl: recipe.provenance.sourceUrl,
        rawLine: p.lines.join("  +  "),
        grams,
        relative: relativeAmount(anchor, composition, grams),
        gramsPerServing:
          recipe.servings && recipe.servings > 0 ? round(grams / recipe.servings) : null,
        basis: p.basis,
      });
      clusters.set(p.fdcId, entry);
    }
  }

  const analysed = resolved.length;

  const all: IngredientCluster[] = [...clusters.entries()].map(([fdcId, entry]) => {
    const rel = entry.sources.map((s) => s.relative).filter((n): n is number => n !== null);
    const per = entry.sources.map((s) => s.gramsPerServing).filter((n): n is number => n !== null);
    const lo = rel.length > 0 ? Math.min(...rel) : null;
    const hi = rel.length > 0 ? Math.max(...rel) : null;

    return {
      fdcId,
      foodDescription: entry.description,
      klass: entry.klass,
      isAnchor: anchorKlass !== null && entry.klass === anchorKlass,
      recipeCount: entry.sources.length,
      frequency: analysed > 0 ? round(entry.sources.length / analysed, 2) : 0,
      medianGrams: round(median(entry.sources.map((s) => s.grams))),
      medianRelative: rel.length > 0 ? round(median(rel), 2) : null,
      // Guarded against a zero low end, which would make the ratio infinite.
      spreadRelative: lo !== null && hi !== null && lo > 0 ? round(hi / lo, 1) : null,
      medianPerServing: per.length > 0 ? round(median(per)) : null,
      sources: entry.sources.sort((a, b) => (b.relative ?? -1) - (a.relative ?? -1)),
    };
  });

  // ── Per-recipe salinity ─────────────────────────────────────────────────
  const drafts = resolved.map(({ recipe, parts, composition, sodiumMg, lineCount }) => {
    const saltEq = (sodiumMg / 1000) * NA_TO_NACL;
    const servings = recipe.servings && recipe.servings > 0 ? recipe.servings : null;
    return {
      siteName: recipe.provenance.siteName,
      sourceUrl: recipe.provenance.sourceUrl,
      servings,
      resolvedLines: parts.length,
      totalLines: lineCount,
      anchorGrams: anchorKlass ? round(classMass(composition, anchorKlass)) : null,
      sodiumMg: Math.round(sodiumMg),
      saltEquivalentGrams: round(saltEq),
      salinityRelative: relativeAmount(anchor, composition, saltEq),
      sodiumMgPerServing: servings ? Math.round(sodiumMg / servings) : null,
      sodiumDailyValueShare: servings
        ? round(sodiumMg / servings / SODIUM_DAILY_VALUE_MG, 2)
        : null,
    };
  });

  // The median is taken over trustworthy recipes only, so that one badly
  // resolved recipe cannot drag the yardstick it will then be judged against.
  const trusted = drafts.filter(
    (d) => d.salinityRelative !== null && d.resolvedLines / d.totalLines >= minResolvedShare,
  );
  const medianSalinity =
    trusted.length > 0 ? round(median(trusted.map((d) => d.salinityRelative!)), 2) : null;

  const recipes: RecipeSummary[] = drafts
    .map((d): RecipeSummary => {
      let salinityFlag: SalinityFlag = "ok";
      if (d.salinityRelative === null || d.resolvedLines / d.totalLines < minResolvedShare) {
        salinityFlag = "unreliable";
      } else if (medianSalinity && d.salinityRelative > medianSalinity * 2) {
        salinityFlag = "high";
      } else if (medianSalinity && d.salinityRelative < medianSalinity * 0.5) {
        salinityFlag = "low";
      }
      return { ...d, salinityFlag };
    })
    .sort((a, b) => (b.salinityRelative ?? -1) - (a.salinityRelative ?? -1));

  const byFrequency = (a: IngredientCluster, b: IngredientCluster) =>
    b.frequency - a.frequency || (b.medianRelative ?? 0) - (a.medianRelative ?? 0);

  return {
    dish: opts.recipes[0]?.dish ?? "",
    section,
    sectionsAvailable,
    analysed,
    anchor,
    withAnchor,
    commonThreshold,
    common: all.filter((c) => c.frequency >= commonThreshold).sort(byFrequency),
    outliers: all
      .filter((c) => c.recipeCount <= outlierMax)
      .sort((a, b) => a.recipeCount - b.recipeCount || (b.medianRelative ?? 0) - (a.medianRelative ?? 0)),
    recipes,
    medianSalinity,
    unmatched,
  };
}
