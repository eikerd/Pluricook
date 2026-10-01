/**
 * What each recipe is made of, as stacked bars — the arithmetic, kept apart
 * from the drawing so it can be tested on its own.
 *
 * Ingredients run from the most mass to the least — summed over every recipe
 * drawn — so the heaviest sit on the baseline where bars compare directly.
 * The first `colored` get a colour of their own; everything lighter folds
 * into one Other band, itemized per recipe so hovering it can say what
 * is inside.
 *
 * Given `perAnchor`, every recipe is first scaled to that many grams of its
 * primary ingredient — the anchor class: meat in a meatloaf, legume in a
 * lentil soup — so a two-pound loaf and a half-pound one draw the same bar.
 * The primary ingredient then drops out: it is the same weight in every bar.
 */

import type { VisualMatrix } from "../../lib/visual-matrix";

export interface StackSegment {
  /** Index into VisualMatrix.ingredients. */
  ingredient: number;
  label: string;
  recipeCount: number;
  /** Its place in the default order, which is its colour: it keeps it when a sort moves it. */
  color: number;
}

export interface StackBar {
  /** Index into VisualMatrix.recipes. */
  recipe: number;
  /** Grams per segment, in segment order; 0 where the recipe does not list it. */
  grams: number[];
  other: number;
  /** What this recipe's Other band holds, largest first. */
  otherItems: Array<{ label: string; grams: number }>;
  /** Everything the recipe lists in grams, coloured or not. */
  total: number;
}

export interface StackComposition {
  segments: StackSegment[];
  bars: StackBar[];
  hasOther: boolean;
  /** Recipes left out because no primary ingredient was weighed to scale them by. */
  unscaled: number[];
}

export interface StackOptions {
  /** How many ingredients get a colour; the rest fold into Other. */
  colored?: number;
  /** Scale every recipe to this many grams of its primary ingredient, and leave that ingredient out. */
  perAnchor?: number;
  /**
   * Order the bars by one ingredient (an index into VisualMatrix.ingredients,
   * or -1 for Other). A coloured ingredient moves to the left edge, so the bars
   * it orders line up there; Other stays at the right end.
   */
  sortBy?: { ingredient: number; dir: "asc" | "desc" };
}

/** More than eight colours cannot be told apart; the eighth slot is Other. */
export const COLORED_SEGMENTS = 7;

const round = (x: number) => Math.round(x * 100) / 100;

/** Each recipe's multiplier to the fixed weight of primary ingredient; null where it has none weighed. */
function scaleFactors(m: VisualMatrix, perAnchor: number | undefined): Array<number | null> {
  if (perAnchor === undefined) return m.recipes.map(() => 1);
  if (m.normalization?.kind !== "class") return m.recipes.map(() => null);
  return m.recipes.map((r) => (r.anchorGrams && r.anchorGrams > 0 ? perAnchor / r.anchorGrams : null));
}

export function stackComposition(m: VisualMatrix, { colored = COLORED_SEGMENTS, perAnchor, sortBy }: StackOptions = {}): StackComposition {
  const factor = scaleFactors(m, perAnchor);
  const scaled = perAnchor !== undefined;
  const drawn = m.recipes.map((_, i) => i).filter((i) => factor[i] !== null);
  const gramsOf = (i: number, j: number) => (m.grams[i]?.[j] ?? 0) * (factor[i] ?? 0);
  const weight = (j: number) => drawn.reduce((sum, i) => sum + gramsOf(i, j), 0);

  const order = m.ingredients
    .map((_, j) => j)
    .filter((j) => weight(j) > 0 && !(scaled && m.ingredients[j]!.isAnchor))
    .sort((a, b) => weight(b) - weight(a));

  const colorOf = new Map(order.map((j, k) => [j, k]));
  const byDefault = order.slice(0, colored);
  const folded = order.slice(colored);
  const leading = sortBy && byDefault.includes(sortBy.ingredient) ? sortBy.ingredient : null;
  const shown = leading === null ? byDefault : [leading, ...byDefault.filter((j) => j !== leading)];

  const bars = drawn.map((i): StackBar => {
    const otherItems = folded
      .filter((j) => gramsOf(i, j) > 0)
      .map((j) => ({ label: m.ingredients[j]!.label, grams: round(gramsOf(i, j)) }))
      .sort((a, b) => b.grams - a.grams);
    const grams = shown.map((j) => round(gramsOf(i, j)));
    const other = round(otherItems.reduce((sum, x) => sum + x.grams, 0));
    return { recipe: i, grams, other, otherItems, total: round(grams.reduce((s, g) => s + g, 0) + other) };
  });

  // Most of the baseline ingredient first, so the bars read as a staircase:
  // as a share of each recipe, or — scaled to one weight of the primary
  // ingredient — in grams, which then compare directly.
  const lead = (c: StackBar) => (scaled ? (c.grams[0] ?? 0) : c.total > 0 ? (c.grams[0] ?? 0) / c.total : 0);
  bars.sort((a, b) => lead(b) - lead(a));
  if (sortBy) {
    // Grams of the chosen ingredient, a recipe without it counting as none.
    // Stable, so equals keep the staircase order above.
    const of = (c: StackBar) => (sortBy.ingredient === -1 ? c.other : gramsOf(c.recipe, sortBy.ingredient));
    const sign = sortBy.dir === "desc" ? -1 : 1;
    bars.sort((a, b) => sign * (of(a) - of(b)));
  }

  return {
    segments: shown.map((j) => ({
      ingredient: j, label: m.ingredients[j]!.label, recipeCount: m.ingredients[j]!.recipeCount, color: colorOf.get(j)!,
    })),
    bars,
    hasOther: folded.length > 0,
    unscaled: m.recipes.map((_, i) => i).filter((i) => factor[i] === null),
  };
}
