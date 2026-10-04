#!/usr/bin/env bun
/**
 * How good are our rules? Every rule, scored against the whole corpus.
 *
 *   bun scripts/rule-scores.ts            # the table, best-reaching first
 *   bun scripts/rule-scores.ts --all      # include rules that caught nothing
 *   bun scripts/rule-scores.ts --write    # refresh data/rules/edge-cases.json
 *
 * --write records every edge case — each line a rule changed, or that nothing
 * could resolve — with its outcome now. rule-scores.test.ts replays the file,
 * so a later change that moves any of them fails until it is looked at. Read
 * the diff before committing it: that diff IS the review.
 */

import { Database } from "bun:sqlite";
import { EDGE_CASES_PATH, edgeCases, gatherRuleEvidence } from "../src/lib/rule-scores";

const write = process.argv.includes("--write");
const all = process.argv.includes("--all");

const db = new Database("usda.db", { readonly: true });
const started = performance.now();
const { scores, results } = await gatherRuleEvidence(db);
const ms = Math.round(performance.now() - started);

const shown = scores
  .filter((s) => all || s.caught > 0)
  .sort((a, b) => b.caught - a.caught || a.rule.localeCompare(b.rule));

const cols: Array<[string, (s: (typeof shown)[number]) => string, boolean]> = [
  ["Rule", (s) => s.rule, false],
  ["Kind", (s) => s.kind, false],
  ["Caught", (s) => String(s.caught), true],
  ["On new recipes", (s) => String(s.onNewRecipes), true],
  ["Right", (s) => String(s.right), true],
  ["Wrong", (s) => String(s.wrong), true],
  ["Score", (s) => (s.score === null ? "—" : `${s.score}%`), true],
];
const body = shown.map((s) => cols.map(([, get]) => get(s)));
const w = cols.map(([h], i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
const fmt = (cells: string[]) => cells.map((c, i) => (cols[i]![2] ? c.padStart(w[i]!) : c.padEnd(w[i]!))).join("  ").trimEnd();
console.log(fmt(cols.map(([h]) => h)));
console.log(w.map((n) => "─".repeat(n)).join("  "));
for (const b of body) console.log(fmt(b));

const idle = scores.filter((s) => s.caught === 0).length;
const edges = edgeCases(results);
console.log(
  `\n${scores.length} rules · ${scores.length - idle} caught something · ${idle} caught nothing` +
    `\n${results.length} lines · ${edges.length} edge cases · ${ms} ms`,
);

if (write) {
  const lines = edges
    .map((r) => ({
      dish: r.line.dish, site: r.line.site, recipeId: r.line.recipeId, line: r.line.line,
      caughtBy: r.caught, outcome: r.outcome,
    }))
    .sort((a, b) => a.dish.localeCompare(b.dish) || a.recipeId.localeCompare(b.recipeId) || a.line.localeCompare(b.line));
  await Bun.write(
    EDGE_CASES_PATH,
    JSON.stringify(
      {
        _comment: [
          "Every edge case the corpus has turned up: each line a rule changed, or that nothing could resolve,",
          "with what it comes to now. Written by `bun scripts/rule-scores.ts --write`; replayed by",
          "src/lib/rule-scores.test.ts, which fails when any of these lines moves. Review the diff.",
        ],
        lines,
      },
      null, 2,
    ) + "\n",
  );
  console.log(`→ ${EDGE_CASES_PATH} (${lines.length} lines)`);
}
