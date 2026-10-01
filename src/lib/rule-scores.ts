/**
 * How good are our rules? Every rule scored by what it catches.
 *
 * The owner, 2026-09-30: keep every edge case our scraping turns up, run it as
 * a test, and score each rule — regex, alias, reject, workaround, gate — "by
 * how many times they happen to have caught issues… so we know how good our
 * regexes are."
 *
 * Decided with the owner the same day:
 *
 * - A rule CAUGHT a line when the line comes out differently with that rule
 *   switched off (rules.ts). Computed, never guessed.
 * - A catch is RIGHT or WRONG only where someone has confirmed the answer: a
 *   golden case in data/ingredients/expectations.json, a person's verdict in
 *   data/rules/verdicts.json, or, for a gate, a person's `confirmed` on a
 *   look-up entry. Otherwise it is unverified.
 * - Score = right / (right + wrong). Caught, and caught on dishes beyond the
 *   one the rule first caught on, say how far a rule reaches; the score says
 *   whether it reaches correctly.
 */

import type { Database } from "bun:sqlite";
import { Glob } from "bun";
import { conversionInput, parseLine } from "./ingredient-line";
import { readAliases, type AliasTable } from "./ingredient-aliases";
import type { Denial, Lookup } from "./lookups";
import { traceRules } from "./rules";
import { toGrams, type Basis } from "./to-grams";
import type { ExtractedRecipe } from "../types/provenance";

/** Rules written into the code. Data rules (alias, pattern, reject, gap) come from their files. */
export const CODE_RULES = [
  "parse:leading-bullet",
  "parse:optional-mark",
  "parse:bracketed-alternate",
  "parse:range-first-figure",
  "parse:unicode-fraction",
  "parse:inch-mark",
  "parse:slash-alternate",
  "line:leading-punctuation",
  "line:number-is-a-count",
  "line:unknown-unit-is-name",
  "line:count-noun-singular",
  "line:count-noun-from-name",
  "line:stated-grams",
  "extract:json-control-chars",
] as const;

/** Look-up kinds, each scored as a gate: how often it sent a page to a person, and how often rightly. */
export const GATE_KINDS: Denial[] = ["not-cleared", "policy", "blocked", "refused", "unreachable", "evasion-suspected"];

export interface CorpusLine {
  line: string;
  dish: string;
  site: string;
  recipeId: string;
  /** When the recipe was captured; orders a rule's catches to find its first dish. */
  capturedAt: string | null;
}

export interface Outcome {
  grams: number | null;
  fdcId: number | null;
  food: string | null;
  basis: Basis;
}

export type Verified = "right" | "wrong" | null;

/** One rule changing one thing: a line's outcome, or a page's fate. */
export interface Catch {
  rule: string;
  /** The line as published, or a page's URL for a gate. */
  subject: string;
  dish: string;
  capturedAt: string | null;
  verified: Verified;
  /** Who confirmed it: "golden", "person", or null. */
  by: "golden" | "person" | null;
}

export interface LineResult {
  line: CorpusLine;
  outcome: Outcome;
  /** Rules that changed this line's outcome. */
  caught: string[];
}

export interface Golden {
  /** Line → the USDA description must contain `expect`, and must not contain `reject`. */
  matches: Map<string, { expect: string; reject?: string }>;
  /** Line → grams within a tolerance. */
  counts: Map<string, { grams: number; tolerance: number }>;
  /** Lines that must come to no amount at all. */
  rejections: Set<string>;
}

export interface PersonVerdict {
  rule: string;
  /** The line as published, or a URL. */
  subject: string;
  verdict: "right" | "wrong";
  by: string;
  at: string;
  note?: string;
}

const sameOutcome = (a: Outcome, b: Outcome) => a.grams === b.grams && a.fdcId === b.fdcId;

/** Does an outcome satisfy what the golden cases say about this line? null when they say nothing. */
export function goldenPasses(golden: Golden, line: string, o: Outcome): boolean | null {
  const m = golden.matches.get(line);
  if (m) {
    const food = (o.food ?? "").toLowerCase();
    return food.includes(m.expect.toLowerCase()) && !(m.reject && food.includes(m.reject.toLowerCase()));
  }
  const c = golden.counts.get(line);
  if (c) return o.grams !== null && Math.abs(o.grams - c.grams) <= c.tolerance;
  if (golden.rejections.has(line)) return o.grams === null;
  return null;
}

/**
 * Right when the rule turned a failing answer into a passing one, wrong when it
 * did the reverse. A person's verdict outranks the golden case.
 */
export function verifyCatch(
  rule: string, line: string, withRule: Outcome, without: Outcome,
  golden: Golden, verdicts: PersonVerdict[],
): { verified: Verified; by: Catch["by"] } {
  const person = verdicts.find((v) => v.rule === rule && v.subject === line);
  if (person) return { verified: person.verdict, by: "person" };
  const on = goldenPasses(golden, line, withRule);
  const off = goldenPasses(golden, line, without);
  if (on === null || off === null || on === off) return { verified: null, by: null };
  return { verified: on ? "right" : "wrong", by: "golden" };
}

/** Run every line with its rules on, then once more per rule that acted, with that rule off. */
export function evaluateLines(
  lines: CorpusLine[],
  evaluate: (line: string) => Outcome,
  golden: Golden,
  verdicts: PersonVerdict[],
): { results: LineResult[]; catches: Catch[] } {
  const results: LineResult[] = [];
  const catches: Catch[] = [];
  for (const l of lines) {
    const base = traceRules(() => evaluate(l.line));
    const caught: string[] = [];
    for (const id of base.fired) {
      const without = traceRules(() => evaluate(l.line), new Set([id])).value;
      if (sameOutcome(base.value, without)) continue;
      caught.push(id);
      catches.push({
        rule: id, subject: l.line, dish: l.dish, capturedAt: l.capturedAt,
        ...verifyCatch(id, l.line, base.value, without, golden, verdicts),
      });
    }
    results.push({ line: l, outcome: base.value, caught: caught.sort() });
  }
  return { results, catches };
}

export interface RuleScore {
  rule: string;
  kind: string;
  /** Lines (or pages) whose outcome this rule changed. */
  caught: number;
  /** Of those, the ones in dishes other than the first dish it caught on. */
  onNewRecipes: number;
  right: number;
  wrong: number;
  /** right / (right + wrong), 0–100; null until something is verified. */
  score: number | null;
}

export function scoreRules(ruleIds: string[], catches: Catch[]): RuleScore[] {
  const byRule = new Map<string, Catch[]>();
  for (const c of catches) byRule.set(c.rule, [...(byRule.get(c.rule) ?? []), c]);
  // Rules that caught something but are not in the catalogue still show: hiding one would hide a typo.
  const ids = [...new Set([...ruleIds, ...byRule.keys()])];
  return ids.map((rule) => {
    const mine = byRule.get(rule) ?? [];
    const first = [...mine].sort(
      (a, b) => (a.capturedAt ?? "9999").localeCompare(b.capturedAt ?? "9999") || a.dish.localeCompare(b.dish),
    )[0];
    const right = mine.filter((c) => c.verified === "right").length;
    const wrong = mine.filter((c) => c.verified === "wrong").length;
    return {
      rule,
      kind: rule.slice(0, rule.indexOf(":")),
      caught: mine.length,
      onNewRecipes: first ? mine.filter((c) => c.dish !== first.dish).length : 0,
      right,
      wrong,
      score: right + wrong > 0 ? Math.round((right / (right + wrong)) * 100) : null,
    };
  });
}

/** Gates: each look-up entry is its kind's catch; a person's `confirmed` verifies it. */
export function gateCatches(dish: string, pages: Lookup[]): Catch[] {
  return pages.map((p) => ({
    rule: `gate:${p.denial}`,
    subject: p.url,
    dish,
    capturedAt: p.firstDeniedAt,
    verified: p.confirmed === true ? "right" : p.confirmed === false ? "wrong" : null,
    by: p.confirmed === true || p.confirmed === false ? "person" : null,
  }));
}

/** Extraction repairs, recorded on each recipe when it was extracted. */
export function extractionCatches(recipe: ExtractedRecipe, verdicts: PersonVerdict[]): Catch[] {
  const url = recipe.provenance.sourceUrl ?? recipe.id;
  return (recipe.extractionRules ?? [])
    .filter((r) => r.changed)
    .map((r) => {
      const person = verdicts.find((v) => v.rule === r.id && v.subject === url);
      return {
        rule: r.id, subject: url, dish: recipe.dish, capturedAt: recipe.provenance.capturedAt,
        verified: person?.verdict ?? null, by: person ? "person" : null,
      };
    });
}

// ── Loading the evidence ─────────────────────────────────────────────────

export const VERDICTS_PATH = "data/rules/verdicts.json";
export const EDGE_CASES_PATH = "data/rules/edge-cases.json";
/** Pasted fixtures that are recipes, scored alongside the extracted corpus. */
const FIXTURES: Array<{ path: string; dish: string; site: string; capturedAt: string }> = [
  { path: "data/fixtures/apple-fritters.txt", dish: "apple-fritters", site: "Kitchen in the shire", capturedAt: "2026-09-26" },
];

export function lineEvaluator(db: Database, aliases: AliasTable): (line: string) => Outcome {
  return (line) => {
    const parsed = parseLine(line);
    const r = toGrams({ ...conversionInput(parsed), name: parsed.name, condition: parsed.preparation, db, aliases });
    return { grams: r.grams, fdcId: r.fdcId, food: r.foodDescription, basis: r.basis };
  };
}

export async function readGolden(path = "data/ingredients/expectations.json"): Promise<Golden> {
  const f = (await Bun.file(path).json()) as {
    cases?: Array<{ line: string; expect: string; reject?: string }>;
    counts?: Array<{ line: string; grams: number; tolerance: number }>;
    rejections?: Array<{ line: string }>;
  };
  return {
    matches: new Map((f.cases ?? []).map((c) => [c.line, { expect: c.expect, reject: c.reject }])),
    counts: new Map((f.counts ?? []).map((c) => [c.line, { grams: c.grams, tolerance: c.tolerance }])),
    rejections: new Set((f.rejections ?? []).map((r) => r.line)),
  };
}

export async function readVerdicts(path = VERDICTS_PATH): Promise<PersonVerdict[]> {
  const file = Bun.file(path);
  return (await file.exists()) ? (((await file.json()) as { verdicts?: PersonVerdict[] }).verdicts ?? []) : [];
}

async function readCorpus(): Promise<{ lines: CorpusLine[]; recipes: ExtractedRecipe[] }> {
  const lines: CorpusLine[] = [];
  const recipes: ExtractedRecipe[] = [];
  for await (const path of new Glob("data/recipes/*.json").scan(".")) {
    const file = (await Bun.file(path).json()) as { recipes?: ExtractedRecipe[] };
    for (const r of file.recipes ?? []) {
      recipes.push(r);
      for (const line of r.ingredientLines) {
        lines.push({ line, dish: r.dish, site: r.provenance.siteName, recipeId: r.id, capturedAt: r.provenance.capturedAt });
      }
    }
  }
  for (const f of FIXTURES) {
    const text = await Bun.file(f.path).text();
    for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
      lines.push({ line, dish: f.dish, site: f.site, recipeId: `fixture:${f.dish}`, capturedAt: f.capturedAt });
    }
  }
  return { lines, recipes };
}

/** Every rule we have: the code's, and one per entry in the data files. */
export async function allRuleIds(aliases: AliasTable): Promise<string[]> {
  return [
    ...CODE_RULES,
    ...GATE_KINDS.map((k) => `gate:${k}`),
    ...[...aliases.exact.keys()].map((k) => `alias:${k}`),
    ...aliases.patterns.map(([k]) => `pattern:${k}`),
    ...aliases.reject.map((k) => `reject:${k}`),
    ...[...aliases.notInUsda.byId.values()].map((e) => `gap:${e.key}`),
  ];
}

export interface RuleEvidence {
  scores: RuleScore[];
  results: LineResult[];
  catches: Catch[];
}

/** The whole corpus, every rule, scored. */
export async function gatherRuleEvidence(db: Database): Promise<RuleEvidence> {
  const aliases = await readAliases();
  const [golden, verdicts, { lines, recipes }] = await Promise.all([readGolden(), readVerdicts(), readCorpus()]);
  const { results, catches } = evaluateLines(lines, lineEvaluator(db, aliases), golden, verdicts);

  for (const r of recipes) catches.push(...extractionCatches(r, verdicts));
  for await (const path of new Glob("data/lookups/*.json").scan(".")) {
    const file = (await Bun.file(path).json()) as { dish: string; pages?: Lookup[] };
    catches.push(...gateCatches(file.dish, file.pages ?? []));
  }

  return { scores: scoreRules(await allRuleIds(aliases), catches), results, catches };
}

/** The lines worth keeping as edge cases: a rule changed them, or nothing could resolve them. */
export function edgeCases(results: LineResult[]): LineResult[] {
  return results.filter((r) => r.caught.length > 0 || r.outcome.grams === null || r.outcome.fdcId === null);
}
