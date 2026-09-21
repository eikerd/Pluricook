#!/usr/bin/env bun
/**
 * Print the source registry as a sortable spreadsheet.
 *
 *   bun scripts/site-report.ts                  # default sort, most-seen first
 *   bun scripts/site-report.ts --sort reachRate # any SiteStats field
 *   bun scripts/site-report.ts --sort host --asc
 *   bun scripts/site-report.ts --csv > sites.csv
 *
 * Columns are the SiteStats fields verbatim, so what sorts here is exactly what
 * a table view in the app will sort on later.
 */

import { DEFAULT_REGISTRY_PATH, openRegistry, siteStats } from "../src/lib/site-registry";
import type { SiteStats } from "../src/types/source";

const argv = process.argv.slice(2);
const flag = (name: string) =>
  argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;

const dbPath = flag("--db") ?? DEFAULT_REGISTRY_PATH;
const sortKey = (flag("--sort") ?? "") as keyof SiteStats | "";
const ascending = argv.includes("--asc");
const asCsv = argv.includes("--csv");

const rows = siteStats(openRegistry(dbPath));

if (sortKey) {
  rows.sort((a, b) => {
    const [x, y] = [a[sortKey], b[sortKey]];
    // Nulls always sort last, whichever direction the rest goes.
    if (x === null) return 1;
    if (y === null) return -1;
    const cmp =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y));
    return ascending ? cmp : -cmp;
  });
}

/** Columns in display order: label, value, and whether to right-align. */
const COLUMNS: Array<[string, (r: SiteStats) => string, boolean]> = [
  ["Site", (r) => r.displayName, false],
  ["Host", (r) => r.host, false],
  ["Stance", (r) => r.stance, false],
  ["Dishes", (r) => String(r.queries), true],
  ["Seen", (r) => String(r.appearances), true],
  ["Best", (r) => (r.bestRank === null ? "-" : String(r.bestRank)), true],
  ["Med", (r) => (r.medianRank === null ? "-" : String(r.medianRank)), true],
  ["Fetch", (r) => String(r.fetches), true],
  ["OK", (r) => String(r.ok), true],
  ["Blkd", (r) => String(r.blocked), true],
  ["Refd", (r) => String(r.refused), true],
  ["Reach", (r) => (r.reachRate === null ? "-" : `${Math.round(r.reachRate * 100)}%`), true],
  ["JSON-LD", (r) => (r.jsonLdRate === null ? "-" : `${Math.round(r.jsonLdRate * 100)}%`), true],
  ["Resc", (r) => String(r.managedRescues), true],
  ["AIban", (r) => String(r.aiCrawlersBlocked), true],
  ["Licensing", (r) => r.licensingContact ?? "-", false],
];

if (asCsv) {
  const esc = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  console.log(COLUMNS.map(([h]) => esc(h)).join(","));
  for (const r of rows) console.log(COLUMNS.map(([, get]) => esc(get(r))).join(","));
} else {
  const header = COLUMNS.map(([h]) => h);
  const body = rows.map((r) => COLUMNS.map(([, get]) => get(r)));
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i]!.length)),
  );

  const line = (cells: string[]) =>
    cells
      .map((c, i) => (COLUMNS[i]![2] ? c.padStart(widths[i]!) : c.padEnd(widths[i]!)))
      .join("  ")
      .trimEnd();

  console.log(line(header));
  console.log(widths.map((w) => "─".repeat(w)).join("  "));
  for (const row of body) console.log(line(row));

  const total = (pick: (r: SiteStats) => number) => rows.reduce((n, r) => n + pick(r), 0);
  console.log(
    `\n${rows.length} sites · ${total((r) => r.appearances)} appearances · ` +
      `${total((r) => r.fetches)} fetch attempts · ` +
      `${total((r) => r.ok)} ok · ${total((r) => r.blocked)} blocked · ` +
      `${total((r) => r.refused)} refused`,
  );
  const prohibited = rows.filter((r) => r.stance === "prohibited");
  if (prohibited.length) {
    console.log(
      `\n⚠  ${prohibited.length} site(s) prohibit data mining or RAG in writing: ` +
        prohibited.map((r) => r.host).join(", "),
    );
  }
}
