#!/usr/bin/env bun
/**
 * Add a hand-entered recipe to the corpus, enforcing the site's manual cap.
 *
 *   bun scripts/add-manual-recipe.ts data/manual/meatloaf-serious-eats.json
 *   bun scripts/add-manual-recipe.ts <file> --dry-run
 *
 * Write the file in VS Code from what you read on the page, then run this. It
 * refuses rather than warns: the cap only means something if it is a gate.
 *
 * What to type in, and what NOT to:
 *   ingredientLines — yes. Facts, and the thing comparison needs.
 *   servings, times — yes. Published for machines already.
 *   stepCount       — a NUMBER, never the step text.
 *   headnote, method prose, photos — never. There is no field for them, by design.
 */

import { Glob } from "bun";
import { curationFor, mayCaptureManually, readCurated } from "../src/lib/curated-sources";
import { canonicalHost } from "../src/lib/site-registry";
import { assertProvenance, type ExtractedRecipe } from "../src/types/provenance";

interface ManualEntry {
  dish: string;
  sourceUrl: string;
  siteName: string;
  sourceTitle: string;
  author?: string | null;
  ingredientLines: string[];
  servings?: number | null;
  servingsRaw?: string | null;
  totalTimeMinutes?: number | null;
  totalTimeRaw?: string | null;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  stepCount?: number | null;
  enteredBy?: string;
  enteredAt?: string;
}

const path = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!path) {
  console.error("usage: bun scripts/add-manual-recipe.ts <file.json> [--dry-run]");
  process.exit(1);
}

const entry: ManualEntry = await Bun.file(path).json();
const host = canonicalHost(entry.sourceUrl);

// Reject the protected layer outright rather than silently dropping it, so a
// well-meaning contributor learns the rule instead of wondering where it went.
const FORBIDDEN = ["headnote", "instructions", "steps", "method", "description", "notes", "image", "photo"];
const smuggled = FORBIDDEN.filter((k) => k in (entry as unknown as Record<string, unknown>));
if (smuggled.length > 0) {
  console.error(
    `Refused: this file carries ${smuggled.join(", ")}.\n` +
      `Only facts are stored — ingredients, yields, times, and a step COUNT.\n` +
      `Headnotes, step wording and photos are the publisher's expression and have no field here.`,
  );
  process.exit(1);
}

// Count what we already hold from this host, from the stored recipes themselves.
let used = 0;
for await (const file of new Glob("data/recipes/*.json").scan(".")) {
  const { recipes } = (await Bun.file(file).json()) as { recipes: ExtractedRecipe[] };
  used += (recipes ?? []).filter(
    (r) => r.provenance.host === host && r.provenance.method === "manual-transcription",
  ).length;
}

const curated = await readCurated();
const site = curationFor(curated, host);
const verdict = mayCaptureManually(site, used);

console.log(`${entry.siteName} (${host})`);
console.log(`  tier         ${site.tier}`);
console.log(`  acquisition  ${site.acquisition}`);
console.log(`  manual cap   ${verdict.cap ?? "n/a"}`);
console.log(`  already held ${used}`);
console.log(`  verdict      ${verdict.ok ? "allowed" : "REFUSED"} — ${verdict.reason}\n`);

if (!verdict.ok) {
  console.error(
    `Refused. To change this, edit data/sources/curated.json — deliberately, ` +
      `with a reason in the note.`,
  );
  process.exit(1);
}

const recipe: ExtractedRecipe = {
  id: `${host}:${entry.dish}:manual:${entry.enteredAt ?? new Date().toISOString().slice(0, 10)}`,
  provenance: {
    host,
    siteName: entry.siteName,
    sourceUrl: entry.sourceUrl,
    author: entry.author ?? null,
    sourceTitle: entry.sourceTitle,
    capturedAt: entry.enteredAt ?? new Date().toISOString().slice(0, 10),
    method: "manual-transcription",
    acquisitionAtCapture: site.acquisition,
    licence: site.licence ?? null,
  },
  dish: entry.dish,
  ingredientLines: entry.ingredientLines,
  servings: entry.servings ?? null,
  servingsRaw: entry.servingsRaw ?? null,
  totalTimeMinutes: entry.totalTimeMinutes ?? null,
  totalTimeRaw: entry.totalTimeRaw ?? null,
  prepTimeMinutes: entry.prepTimeMinutes ?? null,
  cookTimeMinutes: entry.cookTimeMinutes ?? null,
  stepCount: entry.stepCount ?? null,
};

assertProvenance(recipe.provenance);

if (entry.ingredientLines.length === 0) {
  console.error("Refused: no ingredient lines. A recipe without ingredients is not a recipe.");
  process.exit(1);
}

if (dryRun) {
  console.log("--dry-run: would add", recipe.ingredientLines.length, "ingredient lines. Nothing written.");
  process.exit(0);
}

const out = `data/recipes/${entry.dish}.json`;
const existing = (await Bun.file(out).exists())
  ? ((await Bun.file(out).json()) as { dish: string; extractedAt: string; recipes: ExtractedRecipe[] })
  : { dish: entry.dish, extractedAt: new Date().toISOString().slice(0, 10), recipes: [] };

if (existing.recipes.some((r) => r.provenance.sourceUrl === recipe.provenance.sourceUrl)) {
  console.error(`Refused: ${recipe.provenance.sourceUrl} is already in the corpus.`);
  process.exit(1);
}

existing.recipes.push(recipe);
await Bun.write(out, JSON.stringify(existing, null, 2) + "\n");

console.log(
  `Added. ${entry.siteName} now has ${used + 1} of ${verdict.cap} hand-entered recipes.\n` +
    `→ ${out}`,
);
