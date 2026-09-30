#!/usr/bin/env bun
/**
 * What does the line pipeline make of a recipe, line by line?
 *
 *   bun scripts/probe-lines.ts data/fixtures/apple-fritters.txt
 *   bun scripts/probe-lines.ts <file> --strip-bullets   # as JSON-LD would hand the lines over
 *
 * Every non-empty line goes through parseLine → toGrams, exactly as compare.ts
 * runs it, and is printed beside the mass the line itself states. This is how
 * the "Today" of each entry in docs/recipe-gotchas.md is found: run it, don't
 * guess — and run it again after a fix to see the entry change.
 */

import { Database } from "bun:sqlite";
import { conversionInput, parseLine } from "../src/lib/ingredient-line";
import { toGrams } from "../src/lib/to-grams";
import { readAliases } from "../src/lib/ingredient-aliases";

const path = process.argv[2];
const stripBullets = process.argv.includes("--strip-bullets");

if (!path) {
  console.error("usage: bun scripts/probe-lines.ts <file.txt> [--strip-bullets]");
  process.exit(1);
}
const file = Bun.file(path);
if (!(await file.exists())) {
  console.error(`No file at ${path}.`);
  process.exit(1);
}

const db = new Database("usda.db", { readonly: true });
const aliases = await readAliases();
const lines = (await file.text()).split("\n").filter((l) => l.trim() !== "");

for (const raw of lines) {
  // A paste carries its bullets; a JSON-LD recipeIngredient entry does not.
  const line = stripBullets ? raw.replace(/^\s*[•∙·▪*-]\s*/, "") : raw;
  const parsed = parseLine(line);
  const result = toGrams({
    ...conversionInput(parsed),
    name: parsed.name,
    condition: parsed.preparation,
    db,
    aliases,
  });

  console.log(line);
  console.log(`  parsed  ${parsed.quantity} ${parsed.unit} · ${JSON.stringify(parsed.name)}`);
  console.log(`  stated  ${parsed.statedGrams === null ? "—" : `${parsed.statedGrams} g`}`);
  console.log(
    `  grams   ${result.grams === null ? "—" : result.grams.toFixed(1)} · ${result.foodDescription ?? result.basis}`,
  );
}
