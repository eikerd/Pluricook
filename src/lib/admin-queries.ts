/**
 * Read-only queries behind the admin data browser.
 *
 * Editing happens in the source files and in VS Code, so nothing here writes.
 * Each dataset declares its own columns and sortable keys, and the admin UI
 * renders whatever it is given — adding a table here is enough to expose it.
 */

import { Database, } from "bun:sqlite";
import { Glob } from "bun";
import { DEFAULT_REGISTRY_PATH } from "./site-registry";
import { curationFor, readCurated } from "./curated-sources";
import { ownersView } from "./clones";
import { installCategoryTable } from "./usda-categories";
import { usdaFood, type UsdaFoodPage } from "./usda-food";
import type { ExtractedRecipe } from "../types/provenance";

const USDA_PATH = "usda.db";

/** Opened lazily so the app still starts when a database has not been built yet. */
const handles = new Map<string, Database | null>();

function open(path: string): Database | null {
  if (!handles.has(path)) {
    let db: Database | null = null;
    try {
      db = new Database(path, { readonly: true });
    } catch {
      // Not built yet: the table says so rather than failing.
    }
    // The foods table sorts and searches by category, whose names live beside
    // usda.db. Outside the try: a failure here is a bug to see, not a missing file.
    if (db && path === USDA_PATH) installCategoryTable(db);
    handles.set(path, db);
  }
  return handles.get(path) ?? null;
}

/**
 * One USDA food's page, through the same cached handle as the tables.
 * "missing" when usda.db has not been built; null when it holds no such food.
 */
export function usdaFoodPage(fdcId: number): UsdaFoodPage | null | "missing" {
  const db = open(USDA_PATH);
  return db ? usdaFood(db, fdcId) : "missing";
}

export interface Column {
  key: string;
  label: string;
  /** Right-align and format as a number. */
  numeric?: boolean;
  /** Render as a coloured pill rather than plain text. */
  badge?: boolean;
  width?: string;
}

export interface DatasetDef {
  id: string;
  label: string;
  db: string;
  /** FROM/JOIN/WHERE body, without SELECT or ORDER BY. */
  from: string;
  select: string;
  columns: Column[];
  defaultSort: string;
  defaultDir: "asc" | "desc";
  /** Columns a text query matches against, when the table supports search. */
  searchable?: string[];
  /**
   * Column key → SQL expression for ORDER BY.
   *
   * Needed wherever a join puts the same column name on two tables: SQLite
   * resolves a bare name to a table column before a SELECT alias, so
   * `ORDER BY "description"` is ambiguous once foods and portions are joined.
   */
  sortMap?: Record<string, string>;
  /**
   * Enrich rows from the curated source file, then sort and page in memory.
   *
   * Only for small tables: the curated list lives in JSON, not SQL, so tier and
   * acquisition cannot be sorted by the database. The registry is tens of rows,
   * so reading it whole costs nothing; the USDA tables must never do this.
   */
  curated?: boolean;
  /** Rows read from files instead of a database; sorted, searched and paged in memory. */
  rows?: () => Promise<Record<string, unknown>[]>;
}

const RECIPE_FILES = "data/recipes/*.json";

export const DATASETS: DatasetDef[] = [
  {
    id: "sources",
    label: "Sources",
    db: DEFAULT_REGISTRY_PATH,
    select: `s.display_name AS site, s.host, s.trusted,
             COALESCE(p.written_prohibition, 0) AS prohibited,
             COALESCE(json_array_length(p.ai_crawlers_blocked), 0) AS ai_bans,
             p.robots_generic_allows AS robots_ok,
             p.licensing_contact,
             (SELECT COUNT(DISTINCT query) FROM search_appearances a WHERE a.host = s.host) AS dishes,
             (SELECT COUNT(*) FROM search_appearances a WHERE a.host = s.host) AS seen,
             (SELECT MIN(rank) FROM search_appearances a WHERE a.host = s.host) AS best_rank,
             (SELECT COUNT(*) FROM fetch_attempts f WHERE f.host = s.host) AS fetches,
             (SELECT COUNT(*) FROM fetch_attempts f WHERE f.host = s.host AND f.outcome = 'ok') AS ok,
             (SELECT COUNT(*) FROM fetch_attempts f WHERE f.host = s.host AND f.outcome = 'blocked') AS blocked,
             (SELECT COUNT(*) FROM fetch_attempts f WHERE f.host = s.host AND f.outcome = 'refused') AS refused,
             (SELECT COUNT(*) FROM fetch_attempts f WHERE f.host = s.host AND f.outcome = 'ok' AND f.json_ld = 1) AS json_ld,
             s.last_seen_at`,
    from: `FROM sites s LEFT JOIN site_policies p ON p.host = s.host`,
    columns: [
      { key: "tier", label: "★", badge: true },
      { key: "site", label: "Site", width: "16rem" },
      { key: "host", label: "Host", width: "15rem" },
      { key: "stance", label: "Stance", badge: true },
      { key: "acquisition", label: "May take", badge: true },
      { key: "dishes", label: "Dishes", numeric: true },
      { key: "seen", label: "Seen", numeric: true },
      { key: "best_rank", label: "Best rank", numeric: true },
      { key: "fetches", label: "Fetches", numeric: true },
      { key: "ok", label: "OK", numeric: true },
      { key: "blocked", label: "Blocked", numeric: true },
      { key: "refused", label: "Refused", numeric: true },
      { key: "json_ld", label: "JSON-LD", numeric: true },
      { key: "ai_bans", label: "AI bans", numeric: true },
      { key: "licensing_contact", label: "Licensing", width: "16rem" },
      { key: "last_seen_at", label: "Last seen" },
    ],
    defaultSort: "seen",
    defaultDir: "desc",
    searchable: ["s.display_name", "s.host"],
    curated: true,
  },
  {
    id: "fetches",
    label: "Fetch log",
    db: DEFAULT_REGISTRY_PATH,
    select: `s.display_name AS site, f.fetcher, f.status, f.outcome, f.cdn,
             f.json_ld, f.ingredient_count, f.step_count, f.yield_raw,
             f.total_time_raw, f.body_bytes, f.elapsed_ms, f.note`,
    from: `FROM fetch_attempts f JOIN sites s ON s.host = f.host`,
    columns: [
      { key: "site", label: "Site", width: "16rem" },
      { key: "fetcher", label: "Fetcher", badge: true },
      { key: "status", label: "HTTP", numeric: true },
      { key: "outcome", label: "Outcome", badge: true },
      { key: "cdn", label: "CDN" },
      { key: "json_ld", label: "JSON-LD", numeric: true },
      { key: "ingredient_count", label: "Ingr.", numeric: true },
      { key: "step_count", label: "Steps", numeric: true },
      { key: "yield_raw", label: "Yield (raw)", width: "10rem" },
      { key: "total_time_raw", label: "Time (raw)", width: "9rem" },
      { key: "body_bytes", label: "Bytes", numeric: true },
      { key: "elapsed_ms", label: "ms", numeric: true },
      { key: "note", label: "Note", width: "24rem" },
    ],
    defaultSort: "outcome",
    defaultDir: "asc",
    searchable: ["s.display_name", "f.note", "f.outcome"],
  },
  {
    id: "usda-foods",
    label: "USDA foods",
    db: USDA_PATH,
    select: `f.fdc_id, f.dataset, f.description,
             (SELECT ROUND(fn.amount) FROM food_nutrients fn JOIN nutrients n ON n.id = fn.nutrient_id
               WHERE fn.fdc_id = f.fdc_id AND n.name = 'Energy' AND n.unit_name = 'KCAL' LIMIT 1) AS kcal,
             (SELECT ROUND(fn.amount, 1) FROM food_nutrients fn JOIN nutrients n ON n.id = fn.nutrient_id
               WHERE fn.fdc_id = f.fdc_id AND n.name = 'Protein' LIMIT 1) AS protein,
             (SELECT ROUND(fn.amount, 1) FROM food_nutrients fn JOIN nutrients n ON n.id = fn.nutrient_id
               WHERE fn.fdc_id = f.fdc_id AND n.name = 'Total lipid (fat)' LIMIT 1) AS fat,
             (SELECT ROUND(fn.amount, 1) FROM food_nutrients fn JOIN nutrients n ON n.id = fn.nutrient_id
               WHERE fn.fdc_id = f.fdc_id AND n.name = 'Carbohydrate, by difference' LIMIT 1) AS carbs,
             (SELECT COUNT(*) FROM portions p WHERE p.fdc_id = f.fdc_id) AS portions,
             c.description AS category, c.klass AS klass`,
    from: `FROM foods f LEFT JOIN temp.categories c ON c.id = f.category_id`,
    columns: [
      { key: "fdc_id", label: "FDC ID", numeric: true },
      { key: "dataset", label: "Dataset", badge: true },
      { key: "description", label: "Description", width: "34rem" },
      { key: "category", label: "Category", width: "16rem" },
      { key: "klass", label: "Class" },
      { key: "kcal", label: "kcal", numeric: true },
      { key: "protein", label: "Protein g", numeric: true },
      { key: "fat", label: "Fat g", numeric: true },
      { key: "carbs", label: "Carbs g", numeric: true },
      { key: "portions", label: "Portions", numeric: true },
    ],
    defaultSort: "description",
    defaultDir: "asc",
    searchable: ["f.description", "c.description", "c.klass"],
    sortMap: {
      description: "f.description",
      category: "c.description",
      klass: "c.klass",
    },
  },
  {
    id: "usda-portions",
    label: "USDA portions",
    db: USDA_PATH,
    select: `p.fdc_id, f.description, p.amount, p.unit, p.modifier, p.gram_weight, f.dataset`,
    from: `FROM portions p JOIN foods f ON f.fdc_id = p.fdc_id`,
    columns: [
      { key: "description", label: "Food", width: "32rem" },
      { key: "amount", label: "Amount", numeric: true },
      { key: "unit", label: "Unit" },
      { key: "modifier", label: "Measure", width: "18rem" },
      { key: "gram_weight", label: "Grams", numeric: true },
      { key: "dataset", label: "Dataset", badge: true },
      { key: "fdc_id", label: "FDC ID", numeric: true },
    ],
    defaultSort: "description",
    defaultDir: "asc",
    searchable: ["f.description", "p.modifier"],
    sortMap: {
      description: "f.description",
      dataset: "f.dataset",
      fdc_id: "p.fdc_id",
      amount: "p.amount",
      unit: "p.unit",
      modifier: "p.modifier",
      gram_weight: "p.gram_weight",
    },
  },
  {
    id: "recipes",
    label: "Recipes",
    db: "",                    // file-backed: data/recipes/*.json, not a database
    rows: () => readRecipeFiles(RECIPE_FILES),
    select: "",
    from: "",
    columns: [
      { key: "dish", label: "Dish", width: "8rem" },
      { key: "site", label: "Source", width: "15rem" },
      { key: "author", label: "Author", width: "11rem" },
      { key: "title", label: "Title as published", width: "26rem" },
      { key: "ingredients", label: "Ingr", numeric: true },
      { key: "steps", label: "Steps", numeric: true },
      { key: "servings", label: "Serves", numeric: true },
      { key: "minutes", label: "Minutes", numeric: true },
      { key: "servingsRaw", label: "Yield (raw)", width: "11rem" },
      { key: "totalTimeRaw", label: "Time (raw)", width: "9rem" },
      { key: "acquisition", label: "Basis", badge: true },
      { key: "capturedAt", label: "Captured" },
      { key: "url", label: "Source URL", width: "30rem" },
    ],
    defaultSort: "site",
    defaultDir: "asc",
    searchable: ["site", "title", "dish"],
  },
];

export interface PageResult {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  columns: Column[];
  label: string;
  /** The column the rows are sorted by and which way — the default too, so the header can say so. */
  sort: string;
  dir: "asc" | "desc";
  /** Set when the underlying database file has not been built yet. */
  missing?: string;
}

/** Stance is derived, not stored, so it is computed here rather than in SQL. */
function withStance(row: Record<string, unknown>): Record<string, unknown> {
  if (!("prohibited" in row)) return row;
  const stance =
    row.prohibited === 1 ? "prohibited"
    : Number(row.ai_bans) > 0 ? "ai-blocked"
    : row.robots_ok === 1 ? "open"
    : "unknown";
  const { prohibited, robots_ok, ...rest } = row;
  return { ...rest, stance };
}

/**
 * Flatten the extracted recipe files into table rows.
 *
 * Provenance is spread across the row rather than nested, so every credit field
 * is directly visible and sortable — the source is not something you have to
 * expand a row to see.
 */
/**
 * The library's recipes as table rows, as the owner has them. A recipe's dish is
 * its file's name — the one identifier the routes and the comparison use — not
 * the `dish` written inside it, so a RAGG lists exactly the recipes the
 * comparison does.
 */
export async function readRecipeFiles(glob: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];

  for await (const path of new Glob(glob).scan(".")) {
    const file = (await Bun.file(path).json()) as {
      dish: string;
      recipes: ExtractedRecipe[];
    };
    // As the owner has them: the table shows a corrected title, not the captured one.
    const dish = path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
    for (const r of await ownersView(dish, file.recipes ?? [])) {
      rows.push({
        id: r.id,
        dish,
        site: r.provenance.siteName,
        author: r.provenance.author,
        title: r.provenance.sourceTitle,
        ingredients: r.ingredientLines.length,
        steps: r.stepCount,
        servings: r.servings,
        minutes: r.totalTimeMinutes,
        servingsRaw: r.servingsRaw,
        totalTimeRaw: r.totalTimeRaw,
        acquisition: r.provenance.acquisitionAtCapture,
        capturedAt: r.provenance.capturedAt,
        url: r.provenance.sourceUrl,
      });
    }
  }
  return rows;
}

/** Star order, so sorting the ★ column puts required sites first. */
const TIER_RANK: Record<string, number> = {
  required: 0, favorite: 1, normal: 2, blocked: 3,
};

export async function queryDataset(
  id: string,
  opts: { sort?: string; dir?: string; page?: number; pageSize?: number; q?: string },
): Promise<PageResult | null> {
  const def = DATASETS.find((d) => d.id === id);
  if (!def) return null;

  // Sort key is matched against declared columns, never interpolated raw.
  const sortKey = def.columns.some((c) => c.key === opts.sort) ? opts.sort! : def.defaultSort;
  const dir = opts.dir === "asc" || opts.dir === "desc" ? opts.dir : def.defaultDir;

  const base: Omit<PageResult, "rows" | "total"> = {
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 50,
    columns: def.columns,
    label: def.label,
    sort: sortKey,
    dir,
  };

  if (def.rows) {
    const rows = await def.rows();
    const pageSize = Math.min(Math.max(base.pageSize, 1), 500);
    const offset = (Math.max(base.page, 1) - 1) * pageSize;

    const needle = (opts.q ?? "").trim().toLowerCase();
    const filtered = needle
      ? rows.filter((r) =>
          (def.searchable ?? []).some((k) => String(r[k] ?? "").toLowerCase().includes(needle)),
        )
      : rows;

    const asc = dir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const [x, y] = [a[sortKey], b[sortKey]];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const cmp =
        typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return cmp * asc;
    });

    return {
      ...base,
      rows: filtered.slice(offset, offset + pageSize),
      total: filtered.length,
      pageSize,
    };
  }

  const db = open(def.db);
  if (!db) {
    return {
      ...base, rows: [], total: 0,
      missing: `${def.db} has not been built yet.`,
    };
  }

  const pageSize = Math.min(Math.max(base.pageSize, 1), 500);
  const offset = (Math.max(base.page, 1) - 1) * pageSize;

  const q = (opts.q ?? "").trim();
  const where =
    q && def.searchable?.length
      ? ` ${def.from.includes("WHERE") ? "AND" : "WHERE"} (${def.searchable
          .map((c) => `${c} LIKE ?`)
          .join(" OR ")})`
      : "";
  const params = q && def.searchable?.length ? def.searchable.map(() => `%${q}%`) : [];

  // "stance" is computed after the fact, so fall back to a stored column for it.
  const orderBy =
    sortKey === "stance"
      ? "COALESCE(p.written_prohibition, 0) DESC, COALESCE(json_array_length(p.ai_crawlers_blocked), 0)"
      : (def.sortMap?.[sortKey] ?? `"${sortKey}"`);

  const total = (
    db.query<{ n: number }, any[]>(`SELECT COUNT(*) AS n ${def.from}${where}`).get(...params) ?? { n: 0 }
  ).n;

  if (def.curated) {
    // Small table: read it whole, merge the curated decisions, then sort and page
    // in memory, because tier and acquisition live in JSON rather than in SQL.
    const curated = await readCurated();
    const all: Record<string, unknown>[] = db
      .query<Record<string, unknown>, any[]>(`SELECT ${def.select} ${def.from}${where}`)
      .all(...params)
      .map(withStance)
      .map((row) => {
        const c = curationFor(curated, String(row.host));
        return { ...row, tier: c.tier, acquisition: c.acquisition, curationNote: c.note ?? null };
      });

    // A starred site we have never met in a search has no registry row, and would
    // otherwise be invisible in the very table used to manage it.
    const known = new Set(all.map((r) => String(r.host)));
    for (const [host, c] of Object.entries(curated.sites)) {
      if (known.has(host)) continue;
      if (q && !`${host} ${c.displayName ?? ""}`.toLowerCase().includes(q.toLowerCase())) continue;
      all.push({
        site: c.displayName ?? host, host, stance: "unknown",
        tier: c.tier, acquisition: c.acquisition, curationNote: c.note ?? null,
        dishes: 0, seen: 0, best_rank: null, fetches: 0, ok: 0, blocked: 0,
        refused: 0, json_ld: 0, ai_bans: 0, licensing_contact: null, last_seen_at: null,
      });
    }

    const asc = dir === "asc" ? 1 : -1;
    const cell = (row: Record<string, unknown>, key: string): unknown =>
      key === "tier" ? (TIER_RANK[String(row.tier)] ?? 9) : row[key];

    all.sort((a, b) => {
      const [x, y] = [cell(a, sortKey), cell(b, sortKey)];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const cmp =
        typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return cmp * asc;
    });

    return { ...base, rows: all.slice(offset, offset + pageSize), total: all.length, pageSize };
  }

  const rows = db
    .query<Record<string, unknown>, any[]>(
      `SELECT ${def.select} ${def.from}${where}
       ORDER BY ${orderBy} ${dir === "asc" ? "ASC" : "DESC"} NULLS LAST
       LIMIT ${pageSize} OFFSET ${offset}`,
    )
    .all(...params)
    .map(withStance);

  return { ...base, rows, total, pageSize };
}
