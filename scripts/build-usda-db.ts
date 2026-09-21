#!/usr/bin/env bun
/**
 * Build the local USDA lookup database from the downloaded CSV datasets.
 *
 * Run scripts/fetch-usda.ts first. The result, usda.db, is gitignored and
 * rebuildable; nothing queries FoodData Central at request time.
 *
 *   bun scripts/build-usda-db.ts [--db usda.db]
 *
 * Only real food records are kept. The Foundation download ships ~88k rows in
 * food.csv, but all but ~469 are lab samples and market acquisitions — the
 * scaffolding behind the analyses, not foods anyone cooks with.
 */

import { Database } from "bun:sqlite";
import { Glob } from "bun";

const DATASETS = [
  { key: "foundation", dir: "data/usda/foundation", dataType: "foundation_food" },
  { key: "sr-legacy", dir: "data/usda/sr-legacy", dataType: "sr_legacy_food" },
  { key: "survey-fndds", dir: "data/usda/survey-fndds", dataType: "survey_fndds_food" },
] as const;

const dbPath = process.argv.includes("--db")
  ? process.argv[process.argv.indexOf("--db") + 1]!
  : "usda.db";

/**
 * Split one CSV line on RFC 4180 rules.
 *
 * USDA descriptions are full of commas ("Butter, without salt") and embedded
 * quotes, so a naive split on "," corrupts roughly every other row.
 */
function splitCsvLine(line: string): string[] {
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
async function readCsv(path: string): Promise<Record<string, string>[]> {
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
async function findTable(dir: string, name: string): Promise<string | null> {
  const hits = [...new Glob(`${dir}/**/${name}`).scanSync(".")];
  return hits[0] ?? null;
}

const num = (s: string): number | null => {
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const db = new Database(dbPath, { create: true });
db.run(`
  PRAGMA journal_mode = WAL;

  DROP TABLE IF EXISTS foods;
  DROP TABLE IF EXISTS nutrients;
  DROP TABLE IF EXISTS food_nutrients;
  DROP TABLE IF EXISTS portions;
  DROP TABLE IF EXISTS foods_fts;

  CREATE TABLE foods (
    fdc_id      INTEGER PRIMARY KEY,
    dataset     TEXT NOT NULL,
    data_type   TEXT NOT NULL,
    description TEXT NOT NULL,
    category_id INTEGER
  );

  CREATE TABLE nutrients (
    id        INTEGER PRIMARY KEY,
    name      TEXT NOT NULL,
    unit_name TEXT NOT NULL,
    rank      REAL
  );

  CREATE TABLE food_nutrients (
    fdc_id      INTEGER NOT NULL,
    nutrient_id INTEGER NOT NULL,
    amount      REAL,
    PRIMARY KEY (fdc_id, nutrient_id)
  ) WITHOUT ROWID;

  -- The density table TODO.md hand-wrote: real gram weights per household measure.
  CREATE TABLE portions (
    id           INTEGER PRIMARY KEY,
    fdc_id       INTEGER NOT NULL,
    amount       REAL,
    unit         TEXT,
    modifier     TEXT,
    description  TEXT,
    gram_weight  REAL NOT NULL
  );

  CREATE INDEX idx_portions_fdc ON portions(fdc_id);
  CREATE INDEX idx_foods_dataset ON foods(dataset);

  -- Ingredient strings are messy, so search is full-text rather than exact match.
  CREATE VIRTUAL TABLE foods_fts USING fts5(
    description, content='foods', content_rowid='fdc_id', tokenize='porter unicode61'
  );
`);

const insertFood = db.query(
  `INSERT OR IGNORE INTO foods (fdc_id, dataset, data_type, description, category_id)
   VALUES (?, ?, ?, ?, ?)`,
);
const insertNutrient = db.query(
  `INSERT OR REPLACE INTO nutrients (id, name, unit_name, rank) VALUES (?, ?, ?, ?)`,
);
const insertFoodNutrient = db.query(
  `INSERT OR IGNORE INTO food_nutrients (fdc_id, nutrient_id, amount) VALUES (?, ?, ?)`,
);
const insertPortion = db.query(
  `INSERT OR REPLACE INTO portions
   (id, fdc_id, amount, unit, modifier, description, gram_weight)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);

const summary: Array<{
  dataset: string; foods: number; nutrients: number; portions: number;
}> = [];

for (const ds of DATASETS) {
  const foodPath = await findTable(ds.dir, "food.csv");
  if (!foodPath) {
    throw new Error(`${ds.key}: food.csv not found under ${ds.dir} — run scripts/fetch-usda.ts first`);
  }

  // Keep only this dataset's own food type; the rest is analysis scaffolding.
  const foods = (await readCsv(foodPath)).filter((r) => r.data_type === ds.dataType);
  const keep = new Set(foods.map((f) => Number(f.fdc_id)));

  const unitPath = await findTable(ds.dir, "measure_unit.csv");
  const units = new Map<string, string>();
  if (unitPath) {
    for (const u of await readCsv(unitPath)) units.set(u.id!, u.name!);
  }

  const nutrientPath = await findTable(ds.dir, "nutrient.csv");
  const nutrientRows = nutrientPath ? await readCsv(nutrientPath) : [];

  const fnPath = await findTable(ds.dir, "food_nutrient.csv");
  const fnRows = fnPath
    ? (await readCsv(fnPath)).filter((r) => keep.has(Number(r.fdc_id)))
    : [];

  const portionPath = await findTable(ds.dir, "food_portion.csv");
  const portionRows = portionPath
    ? (await readCsv(portionPath)).filter((r) => keep.has(Number(r.fdc_id)))
    : [];

  db.transaction(() => {
    for (const f of foods) {
      insertFood.run(
        Number(f.fdc_id), ds.key, f.data_type!, f.description!, num(f.food_category_id!),
      );
    }
    for (const n of nutrientRows) {
      insertNutrient.run(Number(n.id), n.name!, n.unit_name!, num(n.rank!));
    }
    for (const r of fnRows) {
      insertFoodNutrient.run(Number(r.fdc_id), Number(r.nutrient_id), num(r.amount!));
    }
    for (const p of portionRows) {
      const gram = num(p.gram_weight!);
      if (gram === null) continue;  // a portion with no weight cannot convert anything
      insertPortion.run(
        Number(p.id), Number(p.fdc_id), num(p.amount!),
        // measure_unit_id 9999 means "no coded unit" — the modifier carries it.
        units.get(p.measure_unit_id!) === "undetermined" ? null : units.get(p.measure_unit_id!) ?? null,
        p.modifier || null, p.portion_description || null, gram,
      );
    }
  })();

  summary.push({
    dataset: ds.key, foods: foods.length, nutrients: fnRows.length, portions: portionRows.length,
  });
  console.log(
    `✓ ${ds.key.padEnd(14)} ${String(foods.length).padStart(6)} foods · ` +
      `${String(fnRows.length).padStart(7)} nutrient values · ` +
      `${String(portionRows.length).padStart(6)} portions`,
  );
}

db.run(`INSERT INTO foods_fts (rowid, description) SELECT fdc_id, description FROM foods`);
db.run(`PRAGMA optimize`);

// WAL made the million-row load fast; it must not survive into the finished
// file. A WAL database cannot be opened read-only once its -shm/-wal sidecars
// are gone, and any tool that opens it read-write and exits cleanly deletes
// them — one `sqlite3 usda.db .schema` took down every reader. A reference
// table that is only ever read wants one file and no sidecars, which is also
// what a read-only cloud filesystem will demand.
db.run(`PRAGMA journal_mode = DELETE`);

const count = (sql: string) => db.query<{ n: number }, []>(sql).get()!.n;
console.log(
  `\nBuilt ${dbPath}: ` +
    `${count("SELECT COUNT(*) n FROM foods")} foods · ` +
    `${count("SELECT COUNT(*) n FROM food_nutrients")} nutrient values · ` +
    `${count("SELECT COUNT(*) n FROM portions")} portions · ` +
    `${count("SELECT COUNT(*) n FROM nutrients")} nutrient definitions`,
);
