#!/usr/bin/env bun
/**
 * Fetch and extract the recipes for one dish, then write them to data/recipes/.
 *
 *   bun scripts/extract-dish.ts meatloaf
 *   bun scripts/extract-dish.ts meatloaf --dry-run
 *
 * The permission gate runs before the network call, not after: a site the
 * curated list has not cleared is skipped without being contacted at all.
 * That ordering is the point — `pending-review` means we have not established
 * we may take from a site, so we do not go and look.
 */

import { Glob } from "bun";
import { curationFor, mayFetch, readCurated } from "../src/lib/curated-sources";
import { extractRecipe, type ExtractFailure } from "../src/lib/recipe-extract";
import { canonicalHost } from "../src/lib/site-registry";
import type { ExtractedRecipe } from "../src/types/provenance";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const dish = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!dish) {
  console.error("usage: bun scripts/extract-dish.ts <dish> [--dry-run]");
  process.exit(1);
}

interface Appearance {
  rank: number;
  url: string;
  kind: string;
  displayName?: string;
}

// Gather this dish's recipe results from every observation file that has them.
const targets: Appearance[] = [];
for await (const path of new Glob("data/observations/*.json").scan(".")) {
  const obs = await Bun.file(path).json();
  if (obs.query !== dish) continue;
  for (const a of obs.appearances as Appearance[]) {
    if (a.kind === "recipe") targets.push(a);
  }
}

if (targets.length === 0) {
  console.error(`No recipe results recorded for "${dish}" in data/observations/.`);
  process.exit(1);
}

const curated = await readCurated();

type Row = {
  site: string;
  outcome: "extracted" | "skipped" | "blocked" | "failed" | "error";
  detail: string;
  ingredients: number | "";
  steps: number | "";
  servings: number | "";
  minutes: number | "";
};

const rows: Row[] = [];
const recipes: ExtractedRecipe[] = [];

for (const target of targets.sort((a, b) => a.rank - b.rank)) {
  const host = canonicalHost(target.url);
  const site = curationFor(curated, host);
  const name = target.displayName ?? host;

  // Permission first. A site we may not take from is never contacted.
  if (!mayFetch(site)) {
    rows.push({
      site: name,
      outcome: site.tier === "blocked" ? "blocked" : "skipped",
      detail: `${site.tier} · ${site.acquisition}`,
      ingredients: "", steps: "", servings: "", minutes: "",
    });
    continue;
  }

  try {
    const res = await fetch(target.url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      rows.push({
        site: name, outcome: "error", detail: `HTTP ${res.status}`,
        ingredients: "", steps: "", servings: "", minutes: "",
      });
      continue;
    }

    const result = extractRecipe({
      html: await res.text(),
      sourceUrl: target.url,
      siteName: name,
      acquisition: site.acquisition,
      dish,
      licence: site.licence ?? null,
    });

    if (!result.ok) {
      rows.push({
        site: name, outcome: "failed", detail: result.reason satisfies ExtractFailure,
        ingredients: "", steps: "", servings: "", minutes: "",
      });
      continue;
    }

    recipes.push(result.recipe);
    rows.push({
      site: name,
      outcome: "extracted",
      detail: result.warnings.join("; ") || "—",
      ingredients: result.recipe.ingredientLines.length,
      steps: result.recipe.stepCount ?? "",
      servings: result.recipe.servings ?? "",
      minutes: result.recipe.totalTimeMinutes ?? "",
    });
  } catch (err) {
    rows.push({
      site: name, outcome: "error", detail: String((err as Error).message).slice(0, 48),
      ingredients: "", steps: "", servings: "", minutes: "",
    });
  }
}

// ── Report ────────────────────────────────────────────────
const COLS: Array<[string, (r: Row) => string, boolean]> = [
  ["Site", (r) => r.site, false],
  ["Outcome", (r) => r.outcome, false],
  ["Ingr", (r) => String(r.ingredients), true],
  ["Steps", (r) => String(r.steps), true],
  ["Serves", (r) => String(r.servings), true],
  ["Minutes", (r) => String(r.minutes), true],
  ["Detail", (r) => r.detail, false],
];

const header = COLS.map(([h]) => h);
const body = rows.map((r) => COLS.map(([, get]) => get(r)));
const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
const line = (cells: string[]) =>
  cells.map((c, i) => (COLS[i]![2] ? c.padStart(widths[i]!) : c.padEnd(widths[i]!))).join("  ").trimEnd();

console.log(line(header));
console.log(widths.map((w) => "─".repeat(w)).join("  "));
for (const b of body) console.log(line(b));

const count = (o: Row["outcome"]) => rows.filter((r) => r.outcome === o).length;
console.log(
  `\n${rows.length} candidates · ${count("extracted")} extracted · ` +
    `${count("skipped")} skipped (not cleared) · ${count("blocked")} blocked · ` +
    `${count("failed")} no usable data · ${count("error")} unreachable`,
);

if (dryRun) {
  console.log("\n--dry-run: nothing written.");
} else if (recipes.length > 0) {
  const out = `data/recipes/${dish}.json`;
  await Bun.write(out, JSON.stringify({ dish, extractedAt: new Date().toISOString().slice(0, 10), recipes }, null, 2) + "\n");
  console.log(`\nWrote ${recipes.length} recipes → ${out}`);
}
