#!/usr/bin/env bun
/**
 * Seed data/search-terms.json from a ranked list of searches, once.
 *
 *   bun scripts/seed-search-terms.ts [--list data/fixtures/top-100-searched-recipes.txt] [--force]
 *
 * After seeding, the JSON is the record and is edited there, so the script
 * refuses to overwrite it without --force. Every dish already in the library
 * that the list lacks gets an unranked term, so each recipe has a page to
 * attach to.
 */

import { Glob } from "bun";
import {
  parseRankedList, SEARCH_TERMS_PATH, termsFromList, validateTerms, type SearchTerm, type SlashDecision,
} from "../src/lib/search-terms";

// The owner, 2026-09-28, on the four lines that name two things:
// "Split dishes, merge variants".
const SLASHES: Record<number, SlashDecision> = {
  28: { split: ["Guinness Stew", "Beef Stroganoff"] },
  53: { term: "Quiche Recipe", aliases: ["Crustless Quiche Recipe", "Classic Quiche Recipe"] },
  62: { term: "Ribs Recipe", aliases: ["BBQ Ribs Recipe"] },
  95: { term: "Beef Tenderloin Recipe", aliases: ["Filet Mignon Recipe"] },
};

const arg = (flag: string, fallback: string) =>
  process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1]! : fallback;
const listPath = arg("--list", "data/fixtures/top-100-searched-recipes.txt");

if ((await Bun.file(SEARCH_TERMS_PATH).exists()) && !process.argv.includes("--force")) {
  console.error(`${SEARCH_TERMS_PATH} exists and is the record now; pass --force to replace it.`);
  process.exit(1);
}

const listed = parseRankedList(await Bun.file(listPath).text());
const terms = termsFromList(listed, SLASHES);

const known = new Set(terms.map((t) => t.slug));
const dishes = [...new Glob("data/recipes/*.json").scanSync(".")]
  .map((p) => p.slice(p.lastIndexOf("/") + 1, -".json".length))
  .sort();
const unlisted: SearchTerm[] = dishes
  .filter((d) => !known.has(d))
  .map((slug) => ({
    slug,
    term: `${slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")} Recipe`,
    rank: null,
    group: null,
    note: "In the library, not on the list.",
  }));

const all = [...terms, ...unlisted];
validateTerms(all);

await Bun.write(
  SEARCH_TERMS_PATH,
  `${JSON.stringify(
    {
      _comment: [
        "Search terms: what people type to find a dish, each the landing page its recipes attach to.",
        "A term's slug is the dish key a recipe carries (its file is data/recipes/<slug>.json), so",
        "attaching a recipe to a term is naming its dish.",
        "",
        `Seeded ${new Date().toISOString().slice(0, 10)} by scripts/seed-search-terms.ts from ${listPath}.`,
        "This file is the record now: edit it here.",
        "",
        "rank  — place on that list; null for a dish of ours it lacks. Two terms share #28: the list",
        "        named two dishes on one line.",
        "group — the list's band.",
        "aliases — other names the same page answers to.",
      ],
      terms: all,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `Wrote ${SEARCH_TERMS_PATH}: ${terms.length} terms from ${listed.length} ranked lines` +
    (unlisted.length ? `, and ${unlisted.length} unranked for the library (${unlisted.map((t) => t.slug).join(", ")})` : ""),
);
