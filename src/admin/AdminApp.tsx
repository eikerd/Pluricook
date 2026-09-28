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
import { navigate, recipeIdFromPath, recipePath, usePath } from "./route";
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
  // Opened straight at a recipe's address, Back lands on the list it belongs to.
  const [active, setActive] = useState<string>(() => (recipeIdFromPath(location.pathname) ? "recipes" : "overview"));

  useEffect(() => {
    fetch("/api/admin/datasets").then((r) => r.json()).then(setDatasets).catch(() => setDatasets([]));
  }, []);

  const current = datasets.find((d) => d.id === active);
  /** A rail item always leaves a recipe page for the view it names. */
  const open = (view: string) => {
    setActive(view);
    if (recipeId) navigate("/");
  };
  const isActive = (view: string) => (recipeId ? view === "recipes" : active === view);

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
        {/* Kept mounted under a recipe page, so Back returns to the same dish,
            section and chart rather than to a fresh view. */}
        <div style={{ display: recipeId ? "none" : "contents" }}>
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
              onRowClick={active === "recipes" ? (row) => navigate(recipePath(String(row.id)), { from: "recipes" }) : undefined}
            />
          )}
        </div>
      </main>
    </div>
  );
}
