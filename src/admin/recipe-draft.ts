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

const creditOf = (draft: Draft) => ({ sourceTitle: draft.sourceTitle.trim(), author: draft.author.trim() || null, sourceUrl: draft.sourceUrl.trim() || null });
const sectionsOf = (draft: Draft) => draft.sections.map((s) => ({
  name: s.name.trim() || null,
  lines: s.text.split("\n").map((l) => l.trim()).filter((l) => l !== ""),
}));

/** The correction to send, or null when the draft is the published recipe. */
export function correctionFrom(draft: Draft, published: RecipePageData["published"]): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};

  const credit = creditOf(draft);
  if (credit.sourceTitle !== published.sourceTitle || credit.author !== published.author || credit.sourceUrl !== published.sourceUrl) {
    body.credit = credit;
  }

  for (const key of FACTS) {
    const value = figureOf(draft[key]);
    if (value !== published.facts[key]) body[key] = value;
  }

  const sections = sectionsOf(draft);
  if (!sameSections(sections, published.sections)) body.sections = sections;

  return Object.keys(body).length > 0 ? body : null;
}

/**
 * The whole draft as a correction, every field present. The owner's own copy
 * is written as a whole: diffed against its stored self, an edit made and
 * undone while the first save was still out would read as no change, and the
 * edit would stand.
 */
export function fullCorrection(draft: Draft): Record<string, unknown> {
  return {
    credit: creditOf(draft),
    ...Object.fromEntries(FACTS.map((key) => [key, figureOf(draft[key])])),
    sections: sectionsOf(draft),
  };
}

/** One line of the recipe as a spreadsheet row: the line, and the section it sits in. */
export interface SheetRow {
  section: string;
  line: string;
}

/** The draft's lines, one row each, in the recipe's own order. */
export function rowsOf(draft: Draft): SheetRow[] {
  return draft.sections.flatMap((s) =>
    s.text.split("\n").filter((l) => l.trim() !== "").map((line) => ({ section: s.name, line })));
}

/**
 * The draft with its lines replaced by the rows. Sections are the rows'
 * section names, in the order the rows first name them, so retyping a row's
 * section moves its line and a new name starts a section. A row with no line
 * is a deleted row, and a section left without lines is gone.
 */
export function withRows(draft: Draft, rows: SheetRow[]): Draft {
  const sections = new Map<string, string[]>();
  for (const row of rows) {
    const line = row.line.trim();
    if (line === "") continue;
    const name = row.section.trim();
    sections.set(name, [...(sections.get(name) ?? []), line]);
  }
  return { ...draft, sections: [...sections].map(([name, lines]) => ({ name, text: lines.join("\n") })) };
}

/**
 * Each row's reading — how the parser read it, its grams, its USDA food — found
 * by the row's own text, never its position: while an edit is unsaved, or after
 * a save fails, a deleted or inserted line would otherwise shift every later
 * row onto its neighbour's figures. A line not yet read has none; a line listed
 * twice takes one reading each.
 */
export function pairParsed<T extends { line: string }>(rows: SheetRow[], parsed: T[]): Array<T | null> {
  const unused = new Map<string, T[]>();
  for (const p of parsed) unused.set(p.line.trim(), [...(unused.get(p.line.trim()) ?? []), p]);
  return rows.map((r) => {
    const queue = unused.get(r.line.trim());
    return queue?.shift() ?? null;
  });
}
