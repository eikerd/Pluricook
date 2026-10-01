/**
 * What the USDA datasets we load do not hold, and how we work around it.
 *
 * The owner, 2026-09-30: "we'll have to start our own table of things that just
 * apparently aren't in USDA… add the specs for Maggi and everything else that
 * we have to work around."
 *
 * We load Foundation, SR Legacy and FNDDS. A packaged product such as Maggi
 * Seasoning is only in USDA's Branded Foods dataset, which we do not load; its
 * entry here cites that record. Like aliases.json, this is our layer ON TOP of
 * usda.db, which is never edited.
 *
 * Two kinds of entry, both reached from aliases.json by a NEGATIVE fdcId, which
 * no USDA record can have:
 *
 *   food — a food we specify ourselves: description, class, sodium, portions.
 *   form — a form USDA lacks, counted as another USDA record by dry matter:
 *          fresh noodles become dry noodles at the ratio of the two records'
 *          water content. The line says it was converted (G22).
 */

import type { Database } from "bun:sqlite";

export const NOT_IN_USDA_PATH = "data/ingredients/not-in-usda.json";

export interface OwnPortion {
  amount: number;
  /** A household measure as USDA writes it: "tsp", "tbsp", "cup". */
  unit: string;
  gramWeight: number;
}

export interface OwnFood {
  kind: "food";
  id: number;
  description: string;
  /** A USDA category id, so the food classes as USDA foods do (6 = sauces). */
  categoryId: number;
  sodiumMgPer100g: number;
  portions: OwnPortion[];
  /** Where every figure came from. */
  source: string;
  /** Anything we had to assume, said out loud. */
  assumption?: string;
}

export interface OwnForm {
  kind: "form";
  id: number;
  description: string;
  /** The USDA record the line is counted as: the dry form. */
  countAs: number;
  /** The USDA record whose water content stands for the fresh form. */
  waterFrom: number;
  /** Why, and how far to trust it. */
  note: string;
}

export type NotInUsdaEntry = OwnFood | OwnForm;

export interface NotInUsdaTable {
  byId: Map<number, NotInUsdaEntry>;
}

export const EMPTY_NOT_IN_USDA: NotInUsdaTable = { byId: new Map() };

interface NotInUsdaFile {
  entries?: Record<string, unknown>;
}

export function buildNotInUsda(file: NotInUsdaFile): NotInUsdaTable {
  const byId = new Map<number, NotInUsdaEntry>();
  for (const [key, raw] of Object.entries(file.entries ?? {})) {
    const entry = raw as NotInUsdaEntry;
    if (!Number.isInteger(entry.id) || entry.id >= 0) {
      throw new Error(`not-in-usda "${key}": id must be a negative integer, so it can never be a USDA fdc_id`);
    }
    if (byId.has(entry.id)) throw new Error(`not-in-usda "${key}": id ${entry.id} is used twice`);
    byId.set(entry.id, entry);
  }
  return { byId };
}

export async function readNotInUsda(path = NOT_IN_USDA_PATH): Promise<NotInUsdaTable> {
  const file = Bun.file(path);
  if (!(await file.exists())) return EMPTY_NOT_IN_USDA;
  return buildNotInUsda((await file.json()) as NotInUsdaFile);
}

/**
 * Grams of the dry form that hold the same dry matter as one gram of the fresh.
 * Water percentages are per 100 g, as USDA publishes them.
 */
export function dryFactor(waterFreshPct: number, waterDryPct: number): number {
  return (100 - waterFreshPct) / (100 - waterDryPct);
}

/** A USDA record's water, g per 100 g, or null when it publishes none. */
export function waterOf(db: Database, fdcId: number): number | null {
  const row = db
    .query<{ amount: number | null }, [number]>(
      `SELECT fn.amount FROM food_nutrients fn JOIN nutrients n ON n.id = fn.nutrient_id
       WHERE fn.fdc_id = ?1 AND n.name = 'Water' LIMIT 1`,
    )
    .get(fdcId);
  return row?.amount ?? null;
}
