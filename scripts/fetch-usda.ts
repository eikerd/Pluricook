#!/usr/bin/env bun
/**
 * Download the USDA FoodData Central datasets we hold locally.
 *
 * Nutrition is reference data, not something to look up per request, so these
 * tables live on disk and get refreshed deliberately. The archives are
 * gitignored; this script is the reproducible way to get them back.
 *
 *   bun scripts/fetch-usda.ts           # download and unzip anything missing
 *   bun scripts/fetch-usda.ts --force   # re-download even if present
 *
 * Dataset pages and release dates: https://fdc.nal.usda.gov/download-datasets/
 */

import { $ } from "bun";
import { mkdir } from "node:fs/promises";

const BASE = "https://fdc.nal.usda.gov/fdc-datasets";
const DEST = "data/usda";

interface Dataset {
  key: string;
  file: string;
  release: string;
  /** Why we hold this one, so a future reader can drop it deliberately. */
  purpose: string;
}

const DATASETS: Dataset[] = [
  {
    key: "foundation",
    file: "FoodData_Central_foundation_food_csv_2026-04-30.zip",
    release: "2026-04-30",
    purpose:
      "Foundation Foods — single ingredients with full analytical nutrient panels. The best match for raw recipe ingredients.",
  },
  {
    key: "sr-legacy",
    file: "FoodData_Central_sr_legacy_food_csv_2018-04.zip",
    release: "2018-04 (final)",
    purpose:
      "SR Legacy — the broad historical reference. Frozen in 2018, but still the widest coverage of common foods.",
  },
  {
    key: "survey-fndds",
    file: "FoodData_Central_survey_food_csv_2024-10-31.zip",
    release: "2024-10-31 (2021–2023 data)",
    purpose:
      "FNDDS Survey Foods — prepared dishes and restaurant items, for matching a finished recipe rather than its parts.",
  },
];

const force = process.argv.includes("--force");

await mkdir(DEST, { recursive: true });

for (const ds of DATASETS) {
  const zipPath = `${DEST}/${ds.file}`;
  const dir = `${DEST}/${ds.key}`;

  if (!force && (await Bun.file(zipPath).exists())) {
    console.log(`· ${ds.key} — already present, skipping`);
    continue;
  }

  console.log(`↓ ${ds.key} (${ds.release})`);
  const res = await fetch(`${BASE}/${ds.file}`);
  if (!res.ok) {
    // Loud, not silent: a moved dataset should stop the run, not half-fill the directory.
    throw new Error(
      `${ds.key}: HTTP ${res.status} for ${BASE}/${ds.file} — ` +
        `the release may have been superseded, check https://fdc.nal.usda.gov/download-datasets/`,
    );
  }

  const bytes = await res.arrayBuffer();
  await Bun.write(zipPath, bytes);
  console.log(`  ${(bytes.byteLength / 1_048_576).toFixed(1)} MB → ${zipPath}`);

  await mkdir(dir, { recursive: true });
  await $`unzip -oq ${zipPath} -d ${dir}`;
  console.log(`  unzipped → ${dir}/`);
}

console.log("\nHeld locally:");
for (const ds of DATASETS) {
  const files = [...new Bun.Glob(`${DEST}/${ds.key}/**/*.csv`).scanSync(".")];
  console.log(`  ${ds.key.padEnd(14)} ${String(files.length).padStart(2)} CSV files — ${ds.release}`);
}
