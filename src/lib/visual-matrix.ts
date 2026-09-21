/**
 * One payload for every chart: a recipe × ingredient matrix of anchor-relative
 * amounts, plus how far apart the recipes are.
 *
 * Derived from a Comparison and nothing else, so a chart can never show a number
 * the Comparison grids do not. Pure: no database, no files.
 *
 * Three things a cell can be, and charts must keep them apart:
 *   a number — the recipe uses this much, against the anchor
 *   null     — the recipe does not list it (absent)
 * and, per recipe, `unknownLines`: lines that never reached grams. A recipe with
 * unknown lines may well contain an ingredient its row shows as absent.
 */

import type { FoodClass } from "./anchor";
import type { Comparison } from "./compare";

export interface MatrixIngredient {
  fdcId: number;
  name: string;
  /** Shortest unambiguous form of `name`: charts key categories by it. */
  label: string;
  klass: FoodClass;
  isAnchor: boolean;
  recipeCount: number;
  median: number | null;
}

export interface MatrixRecipe {
  recipeId: string;
  siteName: string;
  unknownLines: number;
  /** Grams of the anchor class in this recipe — the denominator behind its row. */
  anchorGrams: number | null;
  salinity: number | null;
  salinityFlag: string;
}

export interface VisualMatrix {
  dish: string;
  section: string | null;
  unitLabel: string;
  /** How amounts were normalized. Under "clr" they are log-ratios, NOT a % of anything. */
  normalization: { kind: "class" | "clr"; anchorClass: FoodClass | null; reason: string };
  recipes: MatrixRecipe[];
  ingredients: MatrixIngredient[];
  /** values[recipe][ingredient]; null = not listed. */
  values: Array<Array<number | null>>;
  /** The line as published behind each cell, so any mark on any chart can be checked. */
  lines: Array<Array<string | null>>;
  grams: Array<Array<number | null>>;
  /** Sum of each food class per recipe, anchor-relative: the substitution-blind view. */
  classes: FoodClass[];
  classValues: number[][];
  /** 1 − Jaccard on RESOLVED ingredient sets. 0 = same ingredients. */
  membershipDistance: number[][];
  /**
   * Shared-ingredient ratio distance: Aitchison over whatever the two recipes
   * both list. Each pair has its own ingredient basis, so these are NOT distances
   * in one common space — fit for comparing a pair, unfit for a map.
   */
  sharedDistance: Array<Array<number | null>>;
  /** How many ingredients each pair's sharedDistance rests on. */
  sharedCount: number[][];
  /**
   * Indices of the ingredients EVERY recipe lists. Distances over this basis do
   * share one space, with nothing imputed — so a projection may use them.
   */
  fixedBasis: number[];
  /** Aitchison over fixedBasis. Null throughout when the basis has < 2 ingredients. */
  fixedDistance: Array<Array<number | null>>;
}

/**
 * Short labels that stay distinct. USDA names run "Wheat flour, white, bread,
 * enriched"; cut to two segments, bread and all-purpose flour both read "Wheat
 * flour, white" — and a chart keyed by category name silently merges them into
 * one column. Each name grows a segment at a time until no other shares it.
 */
export function uniqueLabels(names: string[]): string[] {
  const parts = names.map((n) => n.split(",").map((x) => x.trim()));
  const take = parts.map(() => 2);
  for (let pass = 0; pass < 12; pass++) {
    const labels = parts.map((p, i) => p.slice(0, take[i]).join(", "));
    const seen = new Map<string, number>();
    labels.forEach((l) => seen.set(l, (seen.get(l) ?? 0) + 1));
    let grew = false;
    labels.forEach((l, i) => {
      if (seen.get(l)! > 1 && take[i]! < parts[i]!.length) { take[i]!++; grew = true; }
    });
    if (!grew) {
      // Identical full names (two records, one description) get their USDA order.
      const count = new Map<string, number>();
      return labels.map((l) => {
        const k = (count.get(l) ?? 0) + 1;
        count.set(l, k);
        return seen.get(l)! > 1 ? `${l} (${k})` : l;
      });
    }
  }
  return names;
}

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Euclidean distance between centred log-ratios, on the parts both rows have. */
export function aitchison(a: Array<number | null>, b: Array<number | null>): number | null {
  const shared: Array<[number, number]> = [];
  a.forEach((x, i) => {
    const y = b[i];
    if (x != null && y != null && x > 0 && y > 0) shared.push([x, y]);
  });
  if (shared.length < 2) return null;
  const meanLog = (k: 0 | 1) => shared.reduce((s, p) => s + Math.log(p[k]), 0) / shared.length;
  const [ma, mb] = [meanLog(0), meanLog(1)];
  const sum = shared.reduce((s, [x, y]) => s + (Math.log(x) - ma - (Math.log(y) - mb)) ** 2, 0);
  return round(Math.sqrt(sum));
}

export function jaccardDistance(a: Array<number | null>, b: Array<number | null>): number {
  let both = 0, either = 0;
  a.forEach((x, i) => {
    const inA = x != null, inB = b[i] != null;
    if (inA && inB) both++;
    if (inA || inB) either++;
  });
  return either === 0 ? 0 : round(1 - both / either);
}

export function buildMatrix(c: Comparison): VisualMatrix {
  // Every cluster, whichever list the Comparison filed it under.
  const clusters = [...c.common, ...c.occasional, ...c.outliers];
  const recipeIndex = new Map(c.recipes.map((r, i) => [r.recipeId, i]));

  const values: Array<Array<number | null>> = c.recipes.map(() => clusters.map(() => null));
  const lines: Array<Array<string | null>> = c.recipes.map(() => clusters.map(() => null));
  const grams: Array<Array<number | null>> = c.recipes.map(() => clusters.map(() => null));
  clusters.forEach((cluster, j) => {
    for (const s of cluster.sources) {
      const i = recipeIndex.get(s.recipeId);
      if (i === undefined || s.relative === null) continue;
      values[i]![j] = s.relative;
      lines[i]![j] = s.rawLine;
      grams[i]![j] = s.grams;
    }
  });

  const unknown = new Map<string, number>();
  for (const u of c.unmatched) unknown.set(u.recipeId, (unknown.get(u.recipeId) ?? 0) + 1);

  const classes = [...new Set(clusters.map((x) => x.klass))];
  const classValues = values.map((row) =>
    classes.map((k) => round(row.reduce<number>((s, v, j) => s + (clusters[j]!.klass === k ? (v ?? 0) : 0), 0), 2)),
  );

  const labels = uniqueLabels(clusters.map((x) => x.foodDescription));
  const fixedBasis = clusters
    .map((_, j) => j)
    .filter((j) => values.length > 0 && values.every((row) => row[j] != null && row[j]! > 0));
  const fixed = values.map((row) => fixedBasis.map((j) => row[j]!));

  return {
    dish: c.dish,
    section: c.section,
    unitLabel: c.anchor.unitLabel,
    normalization: {
      kind: c.anchor.kind,
      anchorClass: c.anchor.kind === "class" ? c.anchor.klass : null,
      reason: c.anchor.reason,
    },
    recipes: c.recipes.map((r) => ({
      recipeId: r.recipeId,
      siteName: r.siteName,
      unknownLines: unknown.get(r.recipeId) ?? 0,
      anchorGrams: r.anchorGrams,
      salinity: r.salinityRelative,
      salinityFlag: r.salinityFlag,
    })),
    ingredients: clusters.map((x, j) => ({
      fdcId: x.fdcId, name: x.foodDescription, label: labels[j]!, klass: x.klass, isAnchor: x.isAnchor,
      recipeCount: x.recipeCount, median: x.medianRelative,
    })),
    values,
    lines,
    grams,
    classes,
    classValues,
    membershipDistance: values.map((a) => values.map((b) => jaccardDistance(a, b))),
    sharedDistance: values.map((a) => values.map((b) => aitchison(a, b))),
    sharedCount: values.map((a) => values.map((b) => a.filter((x, j) => x != null && b[j] != null).length)),
    fixedBasis,
    fixedDistance: fixed.map((a) => fixed.map((b) => (fixedBasis.length < 2 ? null : aitchison(a, b)))),
  };
}

export type CellDiff =
  | { kind: "same-basis"; log2: number }   // both list it: log2(recipe / baseline)
  | { kind: "added" }                      // recipe lists it, baseline does not
  | { kind: "removed" }                    // baseline lists it, recipe does not
  | { kind: "neither" };

/**
 * A cell against a baseline. A missing or zero baseline is "added", never a
 * division: "∞% more" is not information.
 */
export function diffCell(value: number | null, baseline: number | null): CellDiff {
  const has = value != null && value > 0, base = baseline != null && baseline > 0;
  if (has && base) return { kind: "same-basis", log2: round(Math.log2(value! / baseline!)) };
  if (has) return { kind: "added" };
  if (base) return { kind: "removed" };
  return { kind: "neither" };
}
