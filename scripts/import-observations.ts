#!/usr/bin/env bun
/**
 * Load every observation file in data/observations/ into the source registry.
 *
 * One file per search we run, named YYYY-MM-DD-<dish>.json. Re-running is safe:
 * search appearances are de-duplicated on (query, url, seen_at) and policies are
 * upserted, so importing the same file twice does not double the numbers.
 *
 *   bun scripts/import-observations.ts [--db sources.db]
 */

import { Glob } from "bun";
import {
  DEFAULT_REGISTRY_PATH,
  canonicalHost,
  openRegistry,
  recordFetchAttempt,
  recordSearchAppearance,
  touchSite,
  upsertPolicy,
} from "../src/lib/site-registry";
import type { Fetcher, FetchOutcome, ResultKind } from "../src/types/source";

interface ObservationFile {
  query: string;
  seenAt: string;
  appearances: Array<{
    rank: number;
    url: string;
    kind: ResultKind;
    displayName?: string;
  }>;
  fetchAttempts: Array<{
    url: string;
    fetcher: Fetcher;
    status: number;
    outcome: FetchOutcome;
    cdn?: string | null;
    bodyBytes?: number | null;
    elapsedMs?: number | null;
    jsonLd: boolean;
    ingredientCount?: number | null;
    stepCount?: number | null;
    yieldRaw?: string | null;
    totalTimeRaw?: string | null;
    note?: string | null;
  }>;
  policies: Array<{
    host: string;
    robotsGenericAllows: boolean | null;
    aiCrawlersBlocked: string[];
    adNetworkInjected: boolean;
    writtenProhibition: boolean;
    licensingContact: string | null;
    note: string | null;
    checkedAt: string;
  }>;
}

const dbPath =
  process.argv.includes("--db")
    ? process.argv[process.argv.indexOf("--db") + 1]!
    : DEFAULT_REGISTRY_PATH;

const db = openRegistry(dbPath);
const glob = new Glob("data/observations/*.json");

let files = 0;
let appearances = 0;
let fetches = 0;
let policies = 0;

for await (const path of glob.scan(".")) {
  const obs: ObservationFile = await Bun.file(path).json();
  files++;

  // Wrapped in a transaction so a malformed file cannot leave a half-imported search.
  db.transaction(() => {
    for (const a of obs.appearances) {
      // The display name rides in with the appearance, so the report reads
      // "Spend With Pennies" rather than a bare host.
      if (a.displayName) {
        touchSite(db, canonicalHost(a.url), obs.seenAt, a.displayName);
      }
      recordSearchAppearance(db, {
        url: a.url,
        query: obs.query,
        rank: a.rank,
        kind: a.kind,
        seenAt: obs.seenAt,
      });
      appearances++;
    }

    for (const f of obs.fetchAttempts) {
      recordFetchAttempt(db, {
        url: f.url,
        fetcher: f.fetcher,
        status: f.status,
        outcome: f.outcome,
        cdn: f.cdn ?? null,
        bodyBytes: f.bodyBytes ?? null,
        elapsedMs: f.elapsedMs ?? null,
        jsonLd: f.jsonLd,
        ingredientCount: f.ingredientCount ?? null,
        stepCount: f.stepCount ?? null,
        yieldRaw: f.yieldRaw ?? null,
        totalTimeRaw: f.totalTimeRaw ?? null,
        note: f.note ?? null,
        attemptedAt: obs.seenAt,
      });
      fetches++;
    }

    for (const p of obs.policies) {
      upsertPolicy(db, p);
      policies++;
    }
  })();

  console.log(
    `  ${path} — ${obs.appearances.length} results, ` +
      `${obs.fetchAttempts.length} fetches, ${obs.policies.length} policies`,
  );
}

console.log(
  `\nImported ${files} observation file(s) into ${dbPath}: ` +
    `${appearances} appearances, ${fetches} fetch attempts, ${policies} policy records.`,
);
