/**
 * The owner's corrections to captured recipes, kept beside them, never in them.
 *
 * A recipe's lines are the record of what its source published, and the
 * importers (extract-dish, import-collection, add-manual-recipe) regenerate
 * data/recipes from their inputs, so an edit written there would be lost on
 * the next run. A correction lives in data/corrections/<dish>.json, keyed by
 * recipe id, and is applied wherever recipes are read: the comparison uses the
 * owner's version, the published one stays intact, and every correction is a
 * diff in version control.
 *
 * Only facts can be corrected: ingredient lines and their sections, the credit,
 * servings and times. Method text is the publisher's expression and has no
 * field here, as it has none in ExtractedRecipe.
 */

import { canonicalHost } from "./site-registry";
import type { ExtractedRecipe } from "../types/provenance";

export interface RecipeCorrection {
  /** YYYY-MM-DD. */
  correctedAt: string;
  credit?: { sourceTitle: string; author: string | null; sourceUrl: string | null };
  /** Null clears a published figure; absent leaves it as published. */
  servings?: number | null;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  totalTimeMinutes?: number | null;
  /** The whole ingredient list as the owner has it. One unnamed section means undivided. */
  sections?: Array<{ name: string | null; lines: string[] }>;
}

/** Corrections for one dish, by recipe id. */
export type Corrections = Record<string, RecipeCorrection>;

const DIR = "data/corrections";
const FILE_COMMENT = [
  "The owner's corrections to captured recipes, keyed by recipe id. Written by the admin's recipe",
  "page and applied wherever recipes are read; the published recipes in data/recipes stay as captured.",
];

const FACTS = ["servings", "prepTimeMinutes", "cookTimeMinutes", "totalTimeMinutes"] as const;

export async function readCorrections(dish: string): Promise<Corrections> {
  const file = Bun.file(`${DIR}/${dish}.json`);
  if (!(await file.exists())) return {};
  const body = (await file.json()) as { recipes?: Corrections };
  return body.recipes ?? {};
}

async function writeAll(dish: string, recipes: Corrections): Promise<void> {
  await Bun.write(`${DIR}/${dish}.json`, `${JSON.stringify({ _comment: FILE_COMMENT, recipes }, null, 2)}\n`);
}

export async function writeCorrection(dish: string, recipeId: string, correction: RecipeCorrection): Promise<void> {
  await writeAll(dish, { ...(await readCorrections(dish)), [recipeId]: correction });
}

export async function removeCorrection(dish: string, recipeId: string): Promise<void> {
  const rest = { ...(await readCorrections(dish)) };
  delete rest[recipeId];
  await writeAll(dish, rest);
}

/** The recipes as the owner has them. The published objects are never changed. */
export function applyCorrections(recipes: ExtractedRecipe[], corrections: Corrections): ExtractedRecipe[] {
  return recipes.map((r) => {
    const c = corrections[r.id];
    return c ? applyOne(r, c) : r;
  });
}

function applyOne(r: ExtractedRecipe, c: RecipeCorrection): ExtractedRecipe {
  const url = c.credit ? c.credit.sourceUrl : r.provenance.sourceUrl;
  const out: ExtractedRecipe = {
    ...r,
    provenance: { ...r.provenance, ...c.credit, host: url ? canonicalHost(url) : r.provenance.host },
  };
  if (c.sections) {
    const undivided = c.sections.length === 1 && c.sections[0]!.name === null;
    // The flat list follows, so everything that reads it sees the owner's lines too.
    out.ingredientLines = c.sections.flatMap((s) => s.lines);
    out.sections = undivided ? undefined : c.sections.map((s) => ({ name: s.name!, ingredientLines: s.lines }));
  }
  for (const key of FACTS) {
    if (c[key] !== undefined) out[key] = c[key]!;
  }
  return out;
}

// ── Validation: what the recipe page may send ──────────────────────────────

export type Validation = { ok: true; correction: RecipeCorrection } | { ok: false; error: string };

const LIMITS = { line: 300, lines: 300, sections: 30, name: 60, title: 200, author: 120, url: 500, servings: 1000, minutes: 10_000 };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : null);

function readSections(v: unknown): RecipeCorrection["sections"] | string {
  if (!Array.isArray(v) || v.length === 0) return "A recipe needs at least one section.";
  if (v.length > LIMITS.sections) return `A recipe may have at most ${LIMITS.sections} sections.`;
  const sections: NonNullable<RecipeCorrection["sections"]> = [];
  for (const s of v) {
    if (!isObject(s) || !Array.isArray(s.lines)) return "Each section needs a list of lines.";
    const name = s.name === null ? null : text(s.name);
    if (name !== null && name.length > LIMITS.name) return `A section name may be at most ${LIMITS.name} characters.`;
    const lines: string[] = [];
    for (const line of s.lines) {
      const t = text(line);
      if (t === null) return "Every ingredient line must be text.";
      if (t.length > LIMITS.line) return `An ingredient line may be at most ${LIMITS.line} characters.`;
      if (t !== "") lines.push(t);
    }
    sections.push({ name: name === "" ? null : name, lines });
  }
  if (sections.length > 1 && sections.some((s) => s.name === null)) return "When a recipe has several sections, each needs a name.";
  const count = sections.reduce((n, s) => n + s.lines.length, 0);
  if (count === 0) return "A recipe needs at least one ingredient line.";
  if (count > LIMITS.lines) return `A recipe may have at most ${LIMITS.lines} lines.`;
  return sections;
}

function readCredit(v: unknown): RecipeCorrection["credit"] | string {
  if (!isObject(v)) return "The credit must name a title, an author and a source.";
  const sourceTitle = text(v.sourceTitle);
  if (!sourceTitle) return "The recipe needs a title.";
  if (sourceTitle.length > LIMITS.title) return `A title may be at most ${LIMITS.title} characters.`;
  const author = text(v.author) || null;
  if (author && author.length > LIMITS.author) return `An author may be at most ${LIMITS.author} characters.`;
  const url = text(v.sourceUrl) || null;
  if (url) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return "The source must be a web address."; }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "The source must be a web address.";
    if (url.length > LIMITS.url) return `A source address may be at most ${LIMITS.url} characters.`;
  }
  return { sourceTitle, author, sourceUrl: url };
}

function readWhole(v: unknown, min: number, max: number, label: string): number | null | undefined | string {
  if (v === undefined || v === null) return v;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return `${label} must be a whole number from ${min} to ${max}.`;
  return v;
}

/**
 * Build a correction from what the page sent, keeping only the fields a
 * correction may hold. Anything else — a "steps" field included — is dropped.
 */
export function validateCorrection(body: unknown, today = new Date().toISOString().slice(0, 10)): Validation {
  if (!isObject(body)) return { ok: false, error: "The correction must be an object." };
  const correction: RecipeCorrection = { correctedAt: today };

  if (body.sections !== undefined) {
    const sections = readSections(body.sections);
    if (typeof sections === "string") return { ok: false, error: sections };
    correction.sections = sections;
  }
  if (body.credit !== undefined) {
    const credit = readCredit(body.credit);
    if (typeof credit === "string") return { ok: false, error: credit };
    correction.credit = credit;
  }
  const facts: Array<[(typeof FACTS)[number], number, number, string]> = [
    ["servings", 1, LIMITS.servings, "Servings"],
    ["prepTimeMinutes", 0, LIMITS.minutes, "Prep time"],
    ["cookTimeMinutes", 0, LIMITS.minutes, "Cook time"],
    ["totalTimeMinutes", 0, LIMITS.minutes, "Total time"],
  ];
  for (const [key, min, max, label] of facts) {
    const value = readWhole(body[key], min, max, label);
    if (typeof value === "string") return { ok: false, error: value };
    if (value !== undefined) correction[key] = value;
  }
  return { ok: true, correction };
}
