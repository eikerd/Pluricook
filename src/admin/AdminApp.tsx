/**
 * Pluricook admin. The top of the app is the RAGGs — what was searched for, and
 * the sourced recipes gathered for it — newest first. A RAGG opens to its
 * recipes and the tools drawn across them; a recipe opens as a sheet to edit.
 * The tables the pipeline collects sit below, under Data.
 */

import { useEffect, useState } from "react";
import { DataTable } from "./DataTable";
import { RaggList, RaggPage } from "./Raggs";
import { RecipePage } from "./RecipePage";
import {
  navigate, raggPath, raggSlugFromPath, recipeIdFromPath, recipePath, usdaFoodIdFromPath, usdaFoodPath, usePath,
} from "./route";
import { UsdaFoodPage } from "./UsdaFoodPage";
import type { RaggSummary } from "../lib/raggs";
import "../admin.css";

const HOME = "raggs";

/** The page a table's row opens, by table. */
const ROW_PAGE: Record<string, (row: Record<string, unknown>) => string> = {
  recipes: (row) => recipePath(String(row.id)),
  "usda-foods": (row) => usdaFoodPath(Number(row.fdc_id)),
  "usda-portions": (row) => usdaFoodPath(Number(row.fdc_id)),
};

/** The view a page's address belongs to, so Back from a page opened by its address lands there. */
const listOf = (path: string) => (usdaFoodIdFromPath(path) !== null ? "usda-foods" : HOME);

/** How good our rules are (rule-scores.ts): their own rail group, above the raw tables. */
const QUALITY = ["rules", "edge-cases"];

interface DatasetMeta {
  id: string;
  label: string;
  searchable: boolean;
}

export function AdminApp() {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  // Read once here for both the rail and the home list: each read runs the
  // comparison for every RAGG.
  const [raggs, setRaggs] = useState<RaggSummary[] | null>(null);
  const [raggsError, setRaggsError] = useState<string | null>(null);
  const path = usePath();
  const recipeId = recipeIdFromPath(path);
  const raggSlug = raggSlugFromPath(path);
  const fdcId = usdaFoodIdFromPath(path);
  const onPage = recipeId !== null || raggSlug !== null || fdcId !== null;
  const [active, setActive] = useState<string>(() => listOf(location.pathname));
  // The RAGG last opened stays mounted under a recipe opened from it, so Back
  // returns to the same tab, section and chart rather than a fresh page.
  const [openRagg, setOpenRagg] = useState<string | null>(raggSlug);
  // Counts the recipe changes saved from a page. The views kept mounted under it
  // read their data again on each, so Back never shows what was there before.
  const [revision, setRevision] = useState(0);
  const changed = () => setRevision((r) => r + 1);

  useEffect(() => { if (raggSlug) setOpenRagg(raggSlug); }, [raggSlug]);

  useEffect(() => {
    fetch("/api/admin/datasets").then((r) => r.json()).then(setDatasets).catch(() => setDatasets([]));
  }, []);

  useEffect(() => {
    // Saves come quickly; an answer for an older revision must not land after a newer one.
    let stale = false;
    fetch("/api/admin/raggs")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as RaggSummary[];
      })
      .then((list) => { if (!stale) { setRaggs(list); setRaggsError(null); } })
      .catch((e: unknown) => { if (!stale) setRaggsError(e instanceof Error ? e.message : "Could not list the RAGGs"); });
    return () => { stale = true; };
  }, [revision]);

  const current = datasets.find((d) => d.id === active);
  /** A rail item always leaves a page for the view it names. */
  const open = (view: string) => {
    setActive(view);
    if (onPage) navigate("/");
  };
  const isActive = (view: string) => !onPage && active === view;
  const rowPage = ROW_PAGE[active];

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <span className="brand__mark">◍</span>
          <span className="brand__name">Pluricook</span>
          <span className="brand__sub">admin</span>
        </div>

        <nav>
          <p className="rail__group">RAGGs</p>
          <button type="button" className={`rail__item ${isActive(HOME) ? "is-active" : ""}`} onClick={() => open(HOME)}>
            All RAGGs
          </button>
          {(raggs ?? []).map((r) => (
            <button
              type="button"
              key={r.slug}
              className={`rail__item rail__item--sub ${raggSlug === r.slug ? "is-active" : ""}`}
              onClick={() => navigate(raggPath(r.slug), { from: "rail" })}
            >
              {r.name}
            </button>
          ))}

          <p className="rail__group">Quality</p>
          {datasets.filter((d) => QUALITY.includes(d.id)).map((d) => (
            <button
              type="button"
              key={d.id}
              className={`rail__item ${isActive(d.id) ? "is-active" : ""}`}
              onClick={() => open(d.id)}
            >
              {d.label}
            </button>
          ))}

          <p className="rail__group">Data</p>
          {datasets.filter((d) => !QUALITY.includes(d.id)).map((d) => (
            <button
              type="button"
              key={d.id}
              className={`rail__item ${isActive(d.id) ? "is-active" : ""}`}
              onClick={() => open(d.id)}
            >
              {d.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        {/* Keyed by the recipe, so a save still out for one recipe can never land on the next. */}
        {recipeId && <RecipePage key={recipeId} id={recipeId} onLeave={() => open(HOME)} onChanged={changed} />}
        {fdcId !== null && <UsdaFoodPage fdcId={fdcId} onLeave={() => open(active)} />}
        {openRagg && (
          <div style={{ display: raggSlug ? "contents" : "none" }}>
            <RaggPage slug={openRagg} revision={revision} onLeave={() => open(HOME)} />
          </div>
        )}
        {/* Kept mounted under a page, so Back returns to the same sort and page
            of a table rather than to a fresh view. */}
        <div style={{ display: onPage ? "none" : "contents" }}>
          {active === HOME ? (
            <RaggList raggs={raggs} error={raggsError} />
          ) : (
            <DataTable
              datasetId={active}
              searchable={current?.searchable ?? false}
              onRowClick={rowPage ? (row) => navigate(rowPage(row), { from: active }) : undefined}
              revision={revision}
            />
          )}
        </div>
      </main>
    </div>
  );
}
