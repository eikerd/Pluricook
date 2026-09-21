/**
 * Our own ingredient → USDA mapping, layered ON TOP of the USDA tables.
 *
 * The architectural point: `usda.db` is reference data and is never amended.
 * It is gitignored and rebuilt from the published archives, so an edit made
 * there dies at the next rebuild — and, worse, it would detach the nutrition
 * figures from the USDA release they claim to come from. A citable dataset
 * stops being citable the moment you edit it.
 *
 * So what we learn lives in `data/ingredients/aliases.json`, in version
 * control, where each decision carries a reason and shows up in a diff. Same
 * split as curated.json against sources.db: the decision file is tracked, the
 * derived database is disposable.
 *
 * This also changes the shape of the problem. Ranking heuristics are unbounded
 * — every rule that fixes one food breaks another, which is exactly what
 * happened when a first-segment rule fixed milk and beef and cost thirteen
 * points of coverage on bread crumbs. A mapping table is bounded: it only ever
 * improves, and the work is ordinary data entry against a list of misses.
 */

export const ALIASES_PATH = "data/ingredients/aliases.json";

export interface AliasEntry {
  fdcId: number;
  note?: string;
}

interface AliasFile {
  exact?: Record<string, AliasEntry>;
  patterns?: Record<string, AliasEntry>;
  reject?: string[];
}

export type AliasResolution =
  | { kind: "exact"; fdcId: number; note?: string; matched: string }
  | { kind: "pattern"; fdcId: number; note?: string; matched: string }
  /** Explicitly not a food — do not let the heuristics invent a match. */
  | { kind: "reject"; matched: string }
  /** Nothing in our table; fall through to full-text search. */
  | { kind: "none" };

export interface AliasTable {
  exact: Map<string, AliasEntry>;
  /** Sorted longest-first, so "ground beef chuck" wins over "beef". */
  patterns: Array<[string, AliasEntry]>;
  reject: string[];
}

export const EMPTY_TABLE: AliasTable = { exact: new Map(), patterns: [], reject: [] };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function buildAliasTable(file: AliasFile): AliasTable {
  return {
    exact: new Map(Object.entries(file.exact ?? {}).map(([k, v]) => [norm(k), v])),
    // Longest first: a more specific phrase must beat a shorter one that is a
    // substring of it, regardless of the order they were written in.
    patterns: Object.entries(file.patterns ?? {})
      .map(([k, v]) => [norm(k), v] as [string, AliasEntry])
      .sort((a, b) => b[0].length - a[0].length),
    reject: (file.reject ?? []).map(norm),
  };
}

export async function readAliases(path = ALIASES_PATH): Promise<AliasTable> {
  const file = Bun.file(path);
  if (!(await file.exists())) return EMPTY_TABLE;
  return buildAliasTable((await file.json()) as AliasFile);
}

/**
 * Resolve an ingredient phrase against our table.
 *
 * Rejects are checked first: "salt, to taste" should not be allowed to fall
 * through and match something, because a confident wrong answer is the failure
 * mode this whole module exists to avoid.
 */
export function resolveAlias(
  table: AliasTable,
  name: string,
  /**
   * True when the line states a real amount. Reject phrases then do not apply:
   * "1/4 cup parsley, chopped, plus more for serving" contains "for serving" and
   * is still a quarter cup of parsley. Rejection is for lines with NO amount —
   * "parsley, for serving" — where the risk is a parser inventing one.
   */
  quantified = false,
): AliasResolution {
  // Parenthetical asides are dropped BEFORE the reject check. "1 tsp salt (or to
  // taste)" states a real quantity and must resolve; only a bare "salt, to
  // taste" is quantity-free. Rejecting on any occurrence of the phrase zeroed
  // the table salt of every recipe that hedged in brackets.
  const n = norm(name.replace(/\([^)]*\)/g, " "));

  if (!quantified) {
    for (const r of table.reject) {
      if (n === r || n.includes(r)) return { kind: "reject", matched: r };
    }
  }

  const exact = table.exact.get(n);
  if (exact) return { kind: "exact", fdcId: exact.fdcId, note: exact.note, matched: n };

  for (const [pattern, entry] of table.patterns) {
    if (n.includes(pattern)) {
      return { kind: "pattern", fdcId: entry.fdcId, note: entry.note, matched: pattern };
    }
  }

  return { kind: "none" };
}
