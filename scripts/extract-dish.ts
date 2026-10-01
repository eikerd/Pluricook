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
import { curationFor, isListed, mayFetch, readCurated } from "../src/lib/curated-sources";
import { extractRecipe, type ExtractFailure } from "../src/lib/recipe-extract";
import { denialForExtractFailure, denialForStatus, LOOKUPS_HOW_TO, mergeLookups, type DeniedPage, type Lookup } from "../src/lib/lookups";
import { mergeRecipes } from "../src/lib/recipe-merge";
import { evaluateRobots, verdictForStatus, type RobotsVerdict } from "../src/lib/robots";
import { canonicalHost, canonicalUrl } from "../src/lib/site-registry";
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
// Keyed by canonical URL: once a dish has been searched twice the same page
// appears in both files, and fetching it twice would count that source twice in
// every consensus frequency and in the choice of anchor.
const byUrl = new Map<string, Appearance>();
for await (const path of new Glob("data/observations/*.json").scan(".")) {
  const obs = await Bun.file(path).json();
  if (obs.query !== dish) continue;
  for (const a of obs.appearances as Appearance[]) {
    if (a.kind !== "recipe") continue;
    const key = canonicalUrl(a.url);
    const held = byUrl.get(key);
    // Keep the best rank the page has reached.
    if (!held || a.rank < held.rank) byUrl.set(key, a);
  }
}
const targets = [...byUrl.values()];

if (targets.length === 0) {
  console.error(`No recipe results recorded for "${dish}" in data/observations/.`);
  process.exit(1);
}

const curated = await readCurated();

// The local calendar date. toISOString() is UTC, which stamps an evening run in
// America/Chicago with tomorrow's date.
const today = new Date().toLocaleDateString("en-CA");

// robots.txt is per host, so it is read once however many pages a host has.
const robotsCache = new Map<string, { status: number; text: string }>();

/**
 * Clear a host nobody has reviewed, on evidence. Reading robots.txt is not a
 * fetch of the content: the file exists to be read by a crawler before it does
 * anything else, so this is the one request an uncleared host may receive.
 */
async function clearByRobots(url: string): Promise<RobotsVerdict> {
  const u = new URL(url);
  let entry = robotsCache.get(u.host);
  if (!entry) {
    try {
      const res = await fetch(`${u.protocol}//${u.host}/robots.txt`, {
        headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000),
      });
      entry = { status: res.status, text: res.ok ? await res.text() : "" };
    } catch {
      entry = { status: 0, text: "" };
    }
    robotsCache.set(u.host, entry);
  }
  return entry.status === 200 ? evaluateRobots(entry.text, u.pathname) : verdictForStatus(entry.status);
}

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
// Every page turned away — by our rules or by the site — for a person to look up.
const denied: DeniedPage[] = [];

for (const target of targets.sort((a, b) => a.rank - b.rank)) {
  const host = canonicalHost(target.url);
  let site = curationFor(curated, host);
  const name = target.displayName ?? host;

  // A host absent from the curated list is not fetchable by default. It is
  // cleared here on evidence, or it waits for a person.
  if (!isListed(curated, host)) {
    const verdict = await clearByRobots(target.url);
    if (!verdict.cleared) {
      denied.push({ url: target.url, site: name, denial: "not-cleared", detail: verdict.reason, acquisition: null });
      rows.push({
        site: name, outcome: "skipped", detail: `not cleared — ${verdict.reason}`.slice(0, 96),
        ingredients: "", steps: "", servings: "", minutes: "",
      });
      continue;
    }
    site = { ...site, acquisition: "fetch", note: `auto-cleared: ${verdict.reason}` };
  }

  // Permission first. A site we may not take from is never contacted.
  if (!mayFetch(site)) {
    denied.push({
      url: target.url, site: name, denial: site.tier === "blocked" ? "blocked" : "policy",
      detail: `${site.tier} · ${site.acquisition}`, acquisition: site.acquisition,
    });
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
      denied.push({
        url: target.url, site: name, denial: denialForStatus(res.status),
        detail: `HTTP ${res.status}`, acquisition: site.acquisition,
      });
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
      capturedAt: today,
    });

    if (!result.ok) {
      denied.push({
        url: target.url, site: name, denial: denialForExtractFailure(result.reason),
        detail: `page answered, no recipe for automation: ${result.reason}`, acquisition: site.acquisition,
      });
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
    denied.push({
      url: target.url, site: name, denial: "unreachable",
      detail: String((err as Error).message).slice(0, 96), acquisition: site.acquisition,
    });
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

// A refresh merges into what is held; it never replaces it. Writing only this
// run's output would delete every hand-entered recipe, and would drop any recipe
// whose site happened to be unreachable today.
const out = `data/recipes/${dish}.json`;
const existing: ExtractedRecipe[] = (await Bun.file(out).exists())
  ? ((await Bun.file(out).json()) as { recipes: ExtractedRecipe[] }).recipes ?? []
  : [];
const merged = mergeRecipes(existing, recipes);

console.log(
  `\nCorpus: ${merged.recipes.length} recipes — ${merged.added} new, ` +
    `${merged.refreshed} refreshed, ${merged.kept} kept untouched` +
    (merged.keptManual ? ` (${merged.keptManual} hand-entered)` : ""),
);

// The denied list, held beside the corpus. A person's notes on it survive re-runs.
const lookupsOut = `data/lookups/${dish}.json`;
const heldLookups: Lookup[] = (await Bun.file(lookupsOut).exists())
  ? ((await Bun.file(lookupsOut).json()) as { pages: Lookup[] }).pages ?? []
  : [];
const lookups = mergeLookups(heldLookups, denied, recipes.map((r) => r.provenance.sourceUrl!), today);

if (lookups.length > 0) {
  console.log(`\nFor a person to look up — ${lookups.length} page(s) automation could not take (see ${LOOKUPS_HOW_TO}):`);
  for (const l of lookups) {
    console.log(`  ${l.handledAt ? "✓" : "·"} ${l.site} (${l.denial}: ${l.detail}) ${l.url}`);
  }
}

if (dryRun) {
  console.log("--dry-run: nothing written.");
} else if (merged.recipes.length > 0) {
  await Bun.write(
    out,
    JSON.stringify(
      { dish, extractedAt: today, recipes: merged.recipes },
      null, 2,
    ) + "\n",
  );
  console.log(`→ ${out}`);
}
if (!dryRun && lookups.length > 0) {
  await Bun.write(lookupsOut, JSON.stringify({ dish, updatedAt: today, howTo: LOOKUPS_HOW_TO, pages: lookups }, null, 2) + "\n");
  console.log(`→ ${lookupsOut}`);
}
