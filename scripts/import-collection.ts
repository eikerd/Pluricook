#!/usr/bin/env bun
/**
 * Import a personal comparison matrix into the corpus.
 *
 *   bun scripts/import-collection.ts data/personal/detroit-pizza.json
 *   bun scripts/import-collection.ts <file> --dry-run
 *
 * One recipe per source column, each attributed by name. Visibility is decided
 * per column against data/sources/curated.json: no URL means private; a URL plus
 * a permitted source means public. Re-run after filling in URLs or correcting a
 * cell — the import replaces its own earlier records and touches nothing else.
 */

import { Glob } from "bun";
import { curationFor, readCurated } from "../src/lib/curated-sources";
import { decideVisibility, matrixToRecipes, type CollectionFile } from "../src/lib/personal-collection";
import { mergeRecipes } from "../src/lib/recipe-merge";
import { assertProvenance, internalRef, type ExtractedRecipe } from "../src/types/provenance";

const path = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!path) {
  console.error("usage: bun scripts/import-collection.ts <file.json> [--dry-run]");
  process.exit(1);
}

const file = (await Bun.file(path).json()) as CollectionFile;
if (file.convention !== "bare-numbers-are-grams") {
  console.error(`Unsupported convention "${file.convention}". Only bare-numbers-are-grams is understood.`);
  process.exit(1);
}

const curated = await readCurated();

// Hand-entered recipes already public per host, so a manual cap is respected.
const heldByHost = new Map<string, number>();
for await (const f of new Glob("data/recipes/*.json").scan(".")) {
  const { recipes } = (await Bun.file(f).json()) as { recipes: ExtractedRecipe[] };
  for (const r of recipes ?? []) {
    const hand = r.provenance.method === "manual-transcription" || r.provenance.method === "personal-collection";
    if (hand && r.provenance.host && (r.visibility ?? "public") === "public" && !r.id.startsWith(`personal:${file.dish}:`)) {
      heldByHost.set(r.provenance.host, (heldByHost.get(r.provenance.host) ?? 0) + 1);
    }
  }
}

const recipes = matrixToRecipes(file).map((r) => {
  assertProvenance(r.provenance);
  const source = file.sources.find((s) => `personal:${file.dish}:${s.key}` === r.id)!;
  const site = curationFor(curated, r.provenance.host ?? "unlisted.invalid");
  const decision = decideVisibility(
    site, Boolean(r.provenance.sourceUrl), heldByHost.get(r.provenance.host ?? "") ?? 0, source.ownWork === true,
  );
  if (decision.visibility === "public" && r.provenance.host) {
    heldByHost.set(r.provenance.host, (heldByHost.get(r.provenance.host) ?? 0) + 1);
  }
  return {
    ...r,
    visibility: decision.visibility,
    visibilityReason: decision.reason,
    provenance: { ...r.provenance, acquisitionAtCapture: site.acquisition },
  };
});

console.log(`${file.dish} — ${recipes.length} sources from ${file.compiledBy}'s notes\n`);
const w = Math.max(...recipes.map((r) => r.provenance.siteName.length));
for (const r of recipes) {
  console.log(
    `  ${r.provenance.siteName.padEnd(w)}  ${String(r.ingredientLines.length).padStart(2)} lines  ` +
      `${(r.visibility ?? "").padEnd(7)}  ${r.visibilityReason}`,
  );
  console.log(`  ${" ".repeat(w)}  record: ${internalRef(r)}`);
}

const out = `data/recipes/${file.dish}.json`;
const existing: ExtractedRecipe[] = (await Bun.file(out).exists())
  ? ((await Bun.file(out).json()) as { recipes: ExtractedRecipe[] }).recipes ?? []
  : [];
const merged = mergeRecipes(existing, recipes);

console.log(`\nCorpus: ${merged.recipes.length} recipes — ${merged.added} new, ${merged.refreshed} replaced, ${merged.kept} untouched`);
if (dryRun) {
  console.log("--dry-run: nothing written.");
} else {
  await Bun.write(out, JSON.stringify({ dish: file.dish, extractedAt: file.compiledAt, recipes: merged.recipes }, null, 2) + "\n");
  console.log(`→ ${out}`);
}
