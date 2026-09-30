/**
 * The recipe editor's working copy, and the correction it becomes.
 *
 * A correction holds only what differs from the published recipe, so each one
 * stays small and its diff in data/corrections reads as exactly what the owner
 * changed. A draft that differs in nothing is no correction at all.
 */

import type { RecipePageData } from "../lib/compare-service";
import type { RecipeDetail, RecipeFacts } from "../lib/recipe-detail";

type Fact = keyof RecipeFacts;
const FACTS: Fact[] = ["servings", "prepTimeMinutes", "cookTimeMinutes", "totalTimeMinutes"];

/** Every field as the form holds it: text, so a half-typed number is not lost. */
export interface Draft extends Record<Fact, string> {
  sourceTitle: string;
  author: string;
  sourceUrl: string;
  /** One section per block; its lines one per row. */
  sections: Array<{ name: string; text: string }>;
}

/** Start from the recipe as it stands — corrected, when it has been. */
export function draftFrom(detail: RecipeDetail): Draft {
  const figure = (n: number | null) => (n === null ? "" : String(n));
  return {
    sourceTitle: detail.sourceTitle,
    author: detail.author ?? "",
    sourceUrl: detail.sourceUrl ?? "",
    servings: figure(detail.facts.servings),
    prepTimeMinutes: figure(detail.facts.prepTimeMinutes),
    cookTimeMinutes: figure(detail.facts.cookTimeMinutes),
    totalTimeMinutes: figure(detail.facts.totalTimeMinutes),
    sections: detail.sections.map((s) => ({ name: s.name ?? "", text: s.lines.map((l) => l.line).join("\n") })),
  };
}

/** "" clears a figure; digits are a number; anything else goes as typed, for the server to refuse by name. */
function figureOf(text: string): number | string | null {
  const t = text.trim();
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : t;
}

function sameSections(a: Array<{ name: string | null; lines: string[] }>, b: Array<{ name: string | null; lines: string[] }>): boolean {
  return a.length === b.length && a.every((s, i) =>
    s.name === b[i]!.name && s.lines.length === b[i]!.lines.length && s.lines.every((l, j) => l === b[i]!.lines[j]));
}

/** The correction to send, or null when the draft is the published recipe. */
export function correctionFrom(draft: Draft, published: RecipePageData["published"]): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};

  const credit = { sourceTitle: draft.sourceTitle.trim(), author: draft.author.trim() || null, sourceUrl: draft.sourceUrl.trim() || null };
  if (credit.sourceTitle !== published.sourceTitle || credit.author !== published.author || credit.sourceUrl !== published.sourceUrl) {
    body.credit = credit;
  }

  for (const key of FACTS) {
    const value = figureOf(draft[key]);
    if (value !== published.facts[key]) body[key] = value;
  }

  const sections = draft.sections.map((s) => ({
    name: s.name.trim() || null,
    lines: s.text.split("\n").map((l) => l.trim()).filter((l) => l !== ""),
  }));
  if (!sameSections(sections, published.sections)) body.sections = sections;

  return Object.keys(body).length > 0 ? body : null;
}
