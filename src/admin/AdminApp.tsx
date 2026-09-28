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
import { navigate, recipeIdFromPath, recipePath, usdaFoodIdFromPath, usdaFoodPath, usePath } from "./route";
import { UsdaFoodPage } from "./UsdaFoodPage";
import { VisualizeView } from "./VisualizeView";
import "../admin.css";

interface DatasetMeta {
  id: string;
  label: string;
  searchable: boolean;
}

interface OverviewStat {
  label: string;
  value: number | string;
}

function Overview() {
  const [data, setData] = useState<{ stats: OverviewStat[]; warnings: string[] } | null>(null);

  useEffect(() => {
    fetch("/api/admin/overview").then((r) => r.json()).then(setData).catch(() => setData(null));
  }, []);

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
  const fdcId = usdaFoodIdFromPath(path);
  const onPage = recipeId !== null || fdcId !== null;
  // Opened straight at a page's address, Back lands on the list it belongs to.
  const [active, setActive] = useState<string>(() =>
    recipeIdFromPath(location.pathname) ? "recipes" : usdaFoodIdFromPath(location.pathname) !== null ? "usda-foods" : "overview",
  );

  useEffect(() => {
    fetch("/api/admin/datasets").then((r) => r.json()).then(setDatasets).catch(() => setDatasets([]));
  }, []);

  const current = datasets.find((d) => d.id === active);
  /** A rail item always leaves a page for the view it names. */
  const open = (view: string) => {
    setActive(view);
    if (onPage) navigate("/");
  };
  // A recipe can be opened from a chart as well as the list, so the rail marks
  // Recipes; a food is opened from the table still underneath it.
  const isActive = (view: string) => (recipeId ? view === "recipes" : active === view);
  const openRow = (row: Record<string, unknown>) =>
    active === "recipes"
      ? navigate(recipePath(String(row.id)), { from: active })
      : navigate(usdaFoodPath(Number(row.fdc_id)), { from: active });

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
            .filter((d) => d.id === "recipes")
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
        {recipeId && <RecipePage id={recipeId} onLeave={() => open("recipes")} />}
        {fdcId !== null && <UsdaFoodPage fdcId={fdcId} onLeave={() => open(active)} />}
        {/* Kept mounted under a page, so Back returns to the same dish, section,
            chart, sort and page of a table rather than to a fresh view. */}
        <div style={{ display: onPage ? "none" : "contents" }}>
          {active === "overview" ? (
            <Overview />
          ) : active === "comparison" ? (
            <ComparisonView />
          ) : active === "visualize" ? (
            <VisualizeView />
          ) : (
            <DataTable
              datasetId={active}
              searchable={current?.searchable ?? false}
              onRowClick={["recipes", "usda-foods", "usda-portions"].includes(active) ? openRow : undefined}
            />
          )}
        </div>
      </main>
    </div>
  );
}
