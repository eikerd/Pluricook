/**
 * Reading the FoodData Central CSV downloads (data/usda, fetched by
 * scripts/fetch-usda.ts). Shared by build-usda-db and build-usda-categories so
 * the two can never split a line differently.
 */

import { Glob } from "bun";

/**
 * Split one CSV line on RFC 4180 rules.
 *
 * USDA descriptions are full of commas ("Butter, without salt") and embedded
 * quotes, so a naive split on "," corrupts roughly every other row.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }  // escaped quote
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { out.push(field); field = ""; }
    else field += c;
  }
  out.push(field);
  return out;
}

/** Read a CSV into row objects keyed by header name. Files here top out at 35 MB. */
export async function readCsv(path: string): Promise<Record<string, string>[]> {
  const text = await Bun.file(path).text();
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]!).map((h) => h.replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

/** Locate a table inside a dataset dir; the archives unzip one level deeper. */
export async function findTable(dir: string, name: string): Promise<string | null> {
  const hits = [...new Glob(`${dir}/**/${name}`).scanSync(".")];
  return hits[0] ?? null;
}
