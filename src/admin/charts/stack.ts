/**
 * What each recipe is made of, as stacked columns — the arithmetic, kept apart
 * from the drawing so it can be tested on its own.
 *
 * Ingredients are ordered by how many recipes list them, heaviest first among
 * equals, so the most shared sit on the baseline where columns compare
 * directly. The first `colored` get a colour of their own; everything rarer
 * folds into one Other band, itemized per recipe so hovering it can say what
 * is inside.
 */

import type { VisualMatrix } from "../../lib/visual-matrix";

export interface StackSegment {
  /** Index into VisualMatrix.ingredients. */
  ingredient: number;
  label: string;
  recipeCount: number;
}

export interface StackColumn {
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
  columns: StackColumn[];
  hasOther: boolean;
}

/** More than eight colours cannot be told apart; the eighth slot is Other. */
export const COLORED_SEGMENTS = 7;

const round = (x: number) => Math.round(x * 100) / 100;

export function stackComposition(m: VisualMatrix, colored = COLORED_SEGMENTS): StackComposition {
  const gramsOf = (i: number, j: number) => m.grams[i]?.[j] ?? 0;
  const weight = (j: number) => m.recipes.reduce((sum, _, i) => sum + gramsOf(i, j), 0);

  const order = m.ingredients
    .map((_, j) => j)
    .filter((j) => weight(j) > 0)
    .sort((a, b) => m.ingredients[b]!.recipeCount - m.ingredients[a]!.recipeCount || weight(b) - weight(a));

  const shown = order.slice(0, colored);
  const folded = order.slice(colored);

  const columns = m.recipes.map((_, i): StackColumn => {
    const otherItems = folded
      .filter((j) => gramsOf(i, j) > 0)
      .map((j) => ({ label: m.ingredients[j]!.label, grams: gramsOf(i, j) }))
      .sort((a, b) => b.grams - a.grams);
    const grams = shown.map((j) => gramsOf(i, j));
    const other = round(otherItems.reduce((sum, x) => sum + x.grams, 0));
    return { recipe: i, grams, other, otherItems, total: round(grams.reduce((s, g) => s + g, 0) + other) };
  });

  // Largest share of the baseline ingredient first: the columns then read as a
  // staircase, and the same order holds whether the chart shows grams or shares.
  const share = (c: StackColumn) => (c.total > 0 ? (c.grams[0] ?? 0) / c.total : 0);
  columns.sort((a, b) => share(b) - share(a));

  return {
    segments: shown.map((j) => ({ ingredient: j, label: m.ingredients[j]!.label, recipeCount: m.ingredients[j]!.recipeCount })),
    columns,
    hasOther: folded.length > 0,
  };
}
