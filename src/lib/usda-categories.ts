/**
 * USDA's food categories by id, and the class Pluricook groups each into.
 *
 * The names come from data/usda-categories.json (built from the FoodData
 * Central downloads by scripts/build-usda-categories.ts); the class comes from
 * classifyCategory in anchor.ts, the one mapping every comparison and chart
 * already uses. A food's class is what it will be colour-coded by.
 */

import type { Database } from "bun:sqlite";
import { classifyCategory, type FoodClass } from "./anchor";
import file from "../../data/usda-categories.json";

export interface UsdaCategory {
  id: number;
  /** "fdc": SR Legacy and Foundation's categories (ids 1–28). "wweia": survey foods' four-digit codes. */
  system: "fdc" | "wweia";
  code: string;
  description: string;
}

export interface CategoryView extends UsdaCategory {
  klass: FoodClass;
}

export const USDA_CATEGORIES: readonly UsdaCategory[] = (file as { categories: UsdaCategory[] }).categories;
const BY_ID = new Map(USDA_CATEGORIES.map((c) => [c.id, c]));

/**
 * A food's category, named and classed. A category id the table does not know
 * still gets its class — classifyCategory works from the id alone — so only
 * its name and code are missing.
 */
export function categoryOf(id: number | null): CategoryView | null {
  if (id === null) return null;
  const known = BY_ID.get(id);
  return {
    id,
    system: known?.system ?? (id < 100 ? "fdc" : "wweia"),
    code: known?.code ?? "",
    description: known?.description ?? "",
    klass: classifyCategory(id),
  };
}

/**
 * The categories, classed, as a temporary table on a USDA connection, so the
 * foods table can sort and search by them in SQL. A read-only connection may
 * still write TEMP tables; usda.db itself is never touched.
 */
export function installCategoryTable(db: Database): void {
  db.run(`CREATE TEMP TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY, system TEXT NOT NULL, code TEXT NOT NULL,
            description TEXT NOT NULL, klass TEXT NOT NULL)`);
  const insert = db.prepare("INSERT OR REPLACE INTO temp.categories VALUES (?1, ?2, ?3, ?4, ?5)");
  db.transaction(() => {
    for (const c of USDA_CATEGORIES) insert.run(c.id, c.system, c.code, c.description, classifyCategory(c.id));
  })();
}
