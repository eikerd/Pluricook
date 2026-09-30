/**
 * Pluricook admin: a sidebar of data sources and a read-only table viewer.
 *
 * The point is oversight — seeing what the pipeline has actually collected,
 * table by table, while it is being built.
 */

import { useEffect, useState } from "react";
import { ComparisonView } from "./ComparisonView";
import { DataTable } from "./DataTable";
import { RecipePage } from "./RecipePage";
import {
  navigate, recipeIdFromPath, recipePath, termPath, termSlugFromPath, usdaFoodIdFromPath, usdaFoodPath, usePath,
} from "./route";
import { TermPage } from "./TermPage";
import { UsdaFoodPage } from "./UsdaFoodPage";
import { VisualizeView } from "./VisualizeView";
import "../admin.css";

/** The page a table's row opens, by table. */
const ROW_PAGE: Record<string, (row: Record<string, unknown>) => string> = {
  "search-terms": (row) => termPath(String(row.slug)),
  recipes: (row) => recipePath(String(row.id)),
  "usda-foods": (row) => usdaFoodPath(Number(row.fdc_id)),
  "usda-portions": (row) => usdaFoodPath(Number(row.fdc_id)),
};

/** The table a page's address belongs to, so Back from a page opened by its address lands there. */
function listOf(path: string): string {
  if (recipeIdFromPath(path)) return "recipes";
  if (termSlugFromPath(path) !== null) return "search-terms";
  if (usdaFoodIdFromPath(path) !== null) return "usda-foods";
  return "overview";
}

interface DatasetMeta {
  id: string;
  label: string;
  searchable: boolean;
}

interface OverviewStat {
  label: string;
  value: number | string;
}

function Overview({ revision }: { revision: number }) {
  const [data, setData] = useState<{ stats: OverviewStat[]; warnings: string[] } | null>(null);

  useEffect(() => {
    fetch("/api/admin/overview").then((r) => r.json()).then(setData).catch(() => setData(null));
  }, [revision]);

  if (!data) return <div className="pane"><p className="muted">Loading…</p></div>;

  return (
    <div className="pane">
      <header className="pane__head">
        <div>
          <h2>Overview</h2>
        </div>
      </header>

      <div className="tiles">
        {data.stats.map((s) => (
          <div className="tile" key={s.label}>
            <span className="tile__label">{s.label}</span>
            <span className="tile__value">
              {typeof s.value === "number" ? s.value.toLocaleString() : s.value}
            </span>
          </div>
        ))}
      </div>

      {data.warnings.length > 0 && (
        <ul className="warnings">
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AdminApp() {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const path = usePath();
  const recipeId = recipeIdFromPath(path);
  const termSlug = termSlugFromPath(path);
  const fdcId = usdaFoodIdFromPath(path);
  const onPage = recipeId !== null || termSlug !== null || fdcId !== null;
  const [active, setActive] = useState<string>(() => listOf(location.pathname));
  // Counts the recipe changes saved from a page. The views kept mounted under it
  // read their data again on each, so Back never shows what was there before.
  const [revision, setRevision] = useState(0);
  const changed = () => setRevision((r) => r + 1);

  useEffect(() => {
    fetch("/api/admin/datasets").then((r) => r.json()).then(setDatasets).catch(() => setDatasets([]));
  }, []);

  const current = datasets.find((d) => d.id === active);
  /** A rail item always leaves a page for the view it names. */
  const open = (view: string) => {
    setActive(view);
    if (onPage) navigate("/");
  };
  // A recipe can be opened from a chart or a term as well as the list, so the
  // rail marks Recipes; a term or a food is opened from the table still under it.
  const isActive = (view: string) => (recipeId ? view === "recipes" : active === view);
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
          <p className="rail__group">Summary</p>
          <button
            type="button"
            className={`rail__item ${isActive("overview") ? "is-active" : ""}`}
            onClick={() => open("overview")}
          >
            Overview
          </button>

          <p className="rail__group">Acquisition</p>
          {datasets
            .filter((d) => ["sources", "searches", "fetches"].includes(d.id))
            .map((d) => (
              <button
                type="button"
                key={d.id}
                className={`rail__item ${isActive(d.id) ? "is-active" : ""}`}
                onClick={() => open(d.id)}
              >
                {d.label}
              </button>
            ))}

          <p className="rail__group">Reference</p>
          {datasets
            .filter((d) => d.id.startsWith("usda"))
            .map((d) => (
              <button
                type="button"
                key={d.id}
                className={`rail__item ${isActive(d.id) ? "is-active" : ""}`}
                onClick={() => open(d.id)}
              >
                {d.label}
              </button>
            ))}

          <p className="rail__group">Output</p>
          {datasets
            .filter((d) => d.id === "search-terms" || d.id === "recipes")
            .map((d) => (
              <button
                type="button"
                key={d.id}
                className={`rail__item ${isActive(d.id) ? "is-active" : ""}`}
                onClick={() => open(d.id)}
              >
                {d.label}
              </button>
            ))}
          <button
            type="button"
            className={`rail__item ${isActive("comparison") ? "is-active" : ""}`}
            onClick={() => open("comparison")}
          >
            Comparison
          </button>
          <button
            type="button"
            className={`rail__item ${isActive("visualize") ? "is-active" : ""}`}
            onClick={() => open("visualize")}
          >
            Visualize
          </button>
        </nav>

        <p className="rail__foot">
          Read-only, except starring a source, which writes to
          data/sources/curated.json, and correcting a recipe, which writes to
          data/corrections/. Everything else is edited in the repo.
        </p>
      </aside>

      <main className="main">
        {recipeId && <RecipePage id={recipeId} onLeave={() => open("recipes")} onChanged={changed} />}
        {termSlug !== null && <TermPage slug={termSlug} onLeave={() => open("search-terms")} />}
        {fdcId !== null && <UsdaFoodPage fdcId={fdcId} onLeave={() => open(active)} />}
        {/* Kept mounted under a page, so Back returns to the same dish, section,
            chart, sort and page of a table rather than to a fresh view. */}
        <div style={{ display: onPage ? "none" : "contents" }}>
          {active === "overview" ? (
            <Overview revision={revision} />
          ) : active === "comparison" ? (
            <ComparisonView revision={revision} />
          ) : active === "visualize" ? (
            <VisualizeView revision={revision} />
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
