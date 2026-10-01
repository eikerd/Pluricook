import { Database } from "bun:sqlite";
import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import {
  CODE_RULES, EDGE_CASES_PATH, edgeCases, evaluateLines, gateCatches, gatherRuleEvidence, goldenPasses, lineEvaluator,
  scoreRules, type CorpusLine, type Golden, type Outcome,
} from "./rule-scores";
import { readAliases } from "./ingredient-aliases";
import { rule } from "./rules";

const NO_GOLDEN: Golden = { matches: new Map(), counts: new Map(), rejections: new Set() };
const at = (line: string, dish: string, capturedAt: string): CorpusLine =>
  ({ line, dish, site: "s", recipeId: `${dish}:1`, capturedAt });

/**
 * A toy pipeline with two rules: "x:sugar" maps sugar to food 1, and
 * "x:noisy" fires on every line without changing anything.
 */
function toy(line: string): Outcome {
  rule("x:noisy");
  if (line.includes("sugar") && rule("x:sugar")) return { grams: 12, fdcId: 1, food: "Sugars, granulated", basis: "usda-portion" };
  return { grams: 12, fdcId: 2, food: "Sugars, brown", basis: "usda-portion" };
}

describe("evaluateLines", () => {
  test("a rule caught a line only when switching it off changes the outcome", () => {
    const { results, catches } = evaluateLines([at("1 tbsp sugar", "noodles", "2026-09-30")], toy, NO_GOLDEN, []);
    expect(results[0]!.caught).toEqual(["x:sugar"]);
    expect(catches.map((c) => c.rule)).toEqual(["x:sugar"]);
  });

  test("a catch is right when it turns a failing golden case into a passing one", () => {
    const golden: Golden = { ...NO_GOLDEN, matches: new Map([["1 tbsp sugar", { expect: "granulated", reject: "brown" }]]) };
    const { catches } = evaluateLines([at("1 tbsp sugar", "noodles", "2026-09-30")], toy, golden, []);
    expect(catches[0]).toMatchObject({ verified: "right", by: "golden" });
  });

  test("and wrong when it does the reverse", () => {
    const golden: Golden = { ...NO_GOLDEN, matches: new Map([["1 tbsp sugar", { expect: "brown" }]]) };
    const { catches } = evaluateLines([at("1 tbsp sugar", "noodles", "2026-09-30")], toy, golden, []);
    expect(catches[0]).toMatchObject({ verified: "wrong", by: "golden" });
  });

  test("a person's verdict outranks the golden case", () => {
    const golden: Golden = { ...NO_GOLDEN, matches: new Map([["1 tbsp sugar", { expect: "brown" }]]) };
    const verdicts = [{ rule: "x:sugar", subject: "1 tbsp sugar", verdict: "right" as const, by: "owner", at: "2026-09-30" }];
    const { catches } = evaluateLines([at("1 tbsp sugar", "noodles", "2026-09-30")], toy, golden, verdicts);
    expect(catches[0]).toMatchObject({ verified: "right", by: "person" });
  });

  test("with no golden case and no verdict, a catch is unverified", () => {
    const { catches } = evaluateLines([at("1 tbsp sugar", "noodles", "2026-09-30")], toy, NO_GOLDEN, []);
    expect(catches[0]).toMatchObject({ verified: null, by: null });
  });
});

describe("goldenPasses", () => {
  const o = (grams: number | null): Outcome => ({ grams, fdcId: grams === null ? null : 1, food: "Egg", basis: "usda-portion" });
  test("a count passes within its tolerance", () => {
    const g: Golden = { ...NO_GOLDEN, counts: new Map([["2 large eggs", { grams: 100, tolerance: 2 }]]) };
    expect(goldenPasses(g, "2 large eggs", o(101))).toBe(true);
    expect(goldenPasses(g, "2 large eggs", o(110))).toBe(false);
  });
  test("a rejection passes when the line comes to no amount", () => {
    const g: Golden = { ...NO_GOLDEN, rejections: new Set(["salt, to taste"]) };
    expect(goldenPasses(g, "salt, to taste", o(null))).toBe(true);
    expect(goldenPasses(g, "salt, to taste", o(5))).toBe(false);
  });
});

describe("scoreRules", () => {
  test("counts catches, catches beyond the first dish, and scores the verified ones", () => {
    const lines = [at("1 tbsp sugar", "noodles", "2026-09-30"), at("2 cups sugar", "fritters", "2026-09-26"), at("sugar", "pizza", "2026-09-20")];
    const golden: Golden = { ...NO_GOLDEN, matches: new Map([["1 tbsp sugar", { expect: "granulated" }], ["2 cups sugar", { expect: "brown" }]]) };
    const { catches } = evaluateLines(lines, toy, golden, []);
    const [sugar] = scoreRules(["x:sugar"], catches);
    // First caught on pizza (earliest), so noodles and fritters are new dishes.
    expect(sugar).toEqual({ rule: "x:sugar", kind: "x", caught: 3, onNewRecipes: 2, right: 1, wrong: 1, score: 50 });
  });

  test("a rule that never caught anything still shows, at zero", () => {
    expect(scoreRules(["alias:never"], [])[0]).toMatchObject({ caught: 0, score: null });
  });
});

describe("gateCatches", () => {
  test("a person's confirmation scores the gate", () => {
    const page = { url: "https://a/", site: "A", denial: "evasion-suspected" as const, detail: "", acquisition: null,
      firstDeniedAt: "2026-09-30", lastDeniedAt: "2026-09-30", handledAt: null, note: null };
    const catches = gateCatches("noodles", [{ ...page, confirmed: true }, { ...page, url: "https://b/", confirmed: false }, { ...page, url: "https://c/" }]);
    expect(scoreRules(["gate:evasion-suspected"], catches)[0]).toMatchObject({ caught: 3, right: 1, wrong: 1, score: 50 });
  });
});

test("every rule written in the code is in the catalogue", async () => {
  // A rule("…") the catalogue lacks would still be scored, but under no name a
  // person chose; and a catalogued rule that no code asks for is dead.
  const used = new Set<string>();
  for await (const path of new Glob("src/lib/*.ts").scan(".")) {
    if (path.endsWith(".test.ts")) continue;
    for (const m of (await Bun.file(path).text()).matchAll(/\brule\("([^"]+)"\)/g)) used.add(m[1]!);
  }
  expect([...used].sort()).toEqual([...CODE_RULES].sort());
});

// ── Against the real corpus ───────────────────────────────────────────────

const available = await Bun.file("usda.db").exists();
const withDb = available ? describe : describe.skip;

withDb("the edge-case table", () => {
  /**
   * Every edge case the corpus has turned up, replayed. A change to any rule
   * that moves one of these lines fails here, so it is seen and decided, not
   * shipped. If the move is intended: `bun scripts/rule-scores.ts --write`,
   * then read the diff of data/rules/edge-cases.json.
   */
  test("every recorded edge case still comes out as recorded", async () => {
    const snapshot = (await Bun.file(EDGE_CASES_PATH).json()) as {
      lines: Array<{ line: string; outcome: { grams: number | null; fdcId: number | null } }>;
    };
    const evaluate = lineEvaluator(new Database("usda.db", { readonly: true }), await readAliases());
    const moved = snapshot.lines
      .map((e) => ({ e, now: evaluate(e.line) }))
      .filter(({ e, now }) => now.grams !== e.outcome.grams || now.fdcId !== e.outcome.fdcId)
      .map(({ e, now }) => `${e.line}: was ${e.outcome.grams} g of ${e.outcome.fdcId}, now ${now.grams} g of ${now.fdcId}`);
    expect(moved, `edge cases moved:\n  ${moved.join("\n  ")}`).toEqual([]);
  });

  test("the table holds every edge case the corpus has now", async () => {
    const snapshot = (await Bun.file(EDGE_CASES_PATH).json()) as { lines: Array<{ recipeId: string; line: string }> };
    const held = new Set(snapshot.lines.map((l) => `${l.recipeId}\u0000${l.line}`));
    const { results } = await gatherRuleEvidence(new Database("usda.db", { readonly: true }));
    const missing = edgeCases(results).filter((r) => !held.has(`${r.line.recipeId}\u0000${r.line.line}`)).map((r) => r.line.line);
    expect(missing, "new edge cases: run bun scripts/rule-scores.ts --write").toEqual([]);
  });
});
