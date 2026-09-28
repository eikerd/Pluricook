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

/**
 * How to read food_nutrient.csv's nutrient_id column, from the dataset's own
 * nutrient.csv.
 *
 * SR Legacy and Foundation put the FDC nutrient id there (1008 for kcal). The
 * survey (FNDDS) download puts the old SR nutrient number (208) in the same
 * column, so read as an id not one of its 353,015 values joined to anything.
 * nutrient.csv carries both: a value the dataset defines as an id is kept, one
 * it defines as a number becomes that nutrient's id, and anything else — or a
 * number two nutrients share — is null, for the build to count rather than
 * guess. The two never meet: ids run 1001–2069 and numbers 200–961.
 */
export function nutrientIdResolver(
  nutrients: ReadonlyArray<{ id?: string; nutrient_nbr?: string }>,
): (raw: number) => number | null {
  const ids = new Set(nutrients.filter((n) => n.id).map((n) => Number(n.id)));
  const byNumber = new Map<number, number | null>();
  for (const n of nutrients) {
    if (!n.id || !n.nutrient_nbr) continue;
    const nbr = Number(n.nutrient_nbr);
    const id = Number(n.id);
    byNumber.set(nbr, byNumber.has(nbr) && byNumber.get(nbr) !== id ? null : id);
  }
  return (raw) => (ids.has(raw) ? raw : byNumber.get(raw) ?? null);
}

/** Locate a table inside a dataset dir; the archives unzip one level deeper. */
export async function findTable(dir: string, name: string): Promise<string | null> {
  const hits = [...new Glob(`${dir}/**/${name}`).scanSync(".")];
  return hits[0] ?? null;
}
