/**
 * UpSet plot, drawn here rather than imported: @upsetjs is AGPL-3 or a paid
 * commercial licence, and Pluricook is headed for a public deployment.
 *
 * Sets are recipes, members are ingredients. Each column is one exact
 * combination of recipes and counts the ingredients listed by exactly those.
 * Membership only — the heatmap carries the amounts.
 */

import { useMemo } from "react";
import type { VisualMatrix } from "../../lib/visual-matrix";
import { recipeLabel, type ViewProps } from "./views";

interface Combo { members: number[]; ingredients: number[] }

export function combinations(m: VisualMatrix): Combo[] {
  const byKey = new Map<string, Combo>();
  m.ingredients.forEach((_, j) => {
    const members = m.recipes.map((_, i) => i).filter((i) => m.values[i]![j] != null);
    if (members.length === 0) return;
    const key = members.join(",");
    const combo = byKey.get(key) ?? { members, ingredients: [] };
    combo.ingredients.push(j);
    byKey.set(key, combo);
  });
  // Largest first; ties go to the wider combination, so the shared core leads.
  return [...byKey.values()].sort((a, b) => b.ingredients.length - a.ingredients.length || b.members.length - a.members.length);
}

const COL = 30, ROW = 26, BAR_H = 120, LEFT = 210, SET_BAR = 70;

export function UpSet({ m, focus, onPick }: ViewProps) {
  const combos = useMemo(() => combinations(m), [m]);
  const setSize = m.recipes.map((_, i) => m.values[i]!.filter((v) => v != null).length);
  const maxCombo = Math.max(1, ...combos.map((c) => c.ingredients.length));
  const maxSet = Math.max(1, ...setSize);
  const width = LEFT + SET_BAR + combos.length * COL + 20;
  const height = BAR_H + 20 + m.recipes.length * ROW + 10;
  const top = BAR_H + 20;

  return (
    <div className="upset">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img"
        aria-label={`UpSet plot: ${combos.length} distinct combinations of recipes sharing ingredients`}>
        {combos.map((c, k) => {
          const x = LEFT + SET_BAR + k * COL + COL / 2;
          const h = (c.ingredients.length / maxCombo) * (BAR_H - 18);
          const names = c.ingredients.map((j) => m.ingredients[j]!.label).join("\n");
          return (
            <g key={c.members.join(",")} className="upset__combo">
              <title>{`${c.ingredients.length} ingredient(s) listed by exactly: ${c.members.map((i) => m.recipes[i]!.siteName).join(", ")}\n${names}`}</title>
              <rect x={x - 9} y={BAR_H - h} width={18} height={h} className="upset__bar" />
              <text x={x} y={BAR_H - h - 4} className="upset__count">{c.ingredients.length}</text>
              {c.members.length > 1 && (
                <line x1={x} x2={x} y1={top + Math.min(...c.members) * ROW + ROW / 2}
                  y2={top + Math.max(...c.members) * ROW + ROW / 2} className="upset__link" />
              )}
              {m.recipes.map((_, i) => (
                <circle key={i} cx={x} cy={top + i * ROW + ROW / 2} r={6}
                  className={c.members.includes(i) ? "upset__dot is-in" : "upset__dot"}
                  onClick={() => c.members.includes(i) && onPick({ recipe: i, ingredient: c.ingredients[0]! })} />
              ))}
            </g>
          );
        })}
        {m.recipes.map((_, i) => {
          const y = top + i * ROW + ROW / 2;
          const w = (setSize[i]! / maxSet) * (SET_BAR - 12);
          return (
            <g key={i} className={i === focus ? "upset__set is-focus" : "upset__set"}>
              <text x={LEFT - 8} y={y + 4} className="upset__label">{recipeLabel(m, i)}</text>
              <rect x={LEFT + SET_BAR - 6 - w} y={y - 6} width={w} height={12} className="upset__setbar" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
