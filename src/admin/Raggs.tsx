/**
 * The top of the app: the RAGGs (recipe aggregates), newest first, and one
 * RAGG's page — its constituent recipes, each from its own site, with the
 * comparison and the charts drawn across them.
 */

import { useEffect, useMemo, useState } from "react";
import type { RaggPage as RaggPageData, RaggRecipe, RaggSummary } from "../lib/raggs";
import { ComparisonView } from "./ComparisonView";
import { navigate, raggPath, recipePath } from "./route";
import { SortableGrid, type GridColumn } from "./SortableGrid";
import { VisualizeView } from "./VisualizeView";

/** Fetch JSON, refusing a non-OK answer with the server's own message. */
async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const body = (await r.json()) as T | { error: string };
  if (!r.ok) throw new Error(typeof body === "object" && body && "error" in body ? body.error : `HTTP ${r.status}`);
  return body as T;
}

const nth = (n: number) => (r: RaggSummary) => r.topIngredients[n] ?? null;

const LIST_COLUMNS: GridColumn<RaggSummary>[] = [
  { key: "name", label: "RAGG", value: (r) => r.name, render: (r) => <strong>{r.name}</strong> },
  { key: "created", label: "Created", value: (r) => r.created },
  { key: "recipes", label: "Recipes", numeric: true, value: (r) => r.recipes },
  { key: "sites", label: "Sites", numeric: true, value: (r) => r.sites },
  { key: "top1", label: "Most common", value: nth(0) },
  { key: "top2", label: "2nd", value: nth(1) },
  { key: "top3", label: "3rd", value: nth(2) },
];

export function RaggList({ revision }: { revision: number }) {
  const [raggs, setRaggs] = useState<RaggSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<RaggSummary[]>("/api/admin/raggs")
      .then((list) => { setRaggs(list); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not list the RAGGs"));
  }, [revision]);

  return (
    <div className="pane">
      <header className="pane__head">
        <div><h2>RAGGs</h2></div>
      </header>
      {error ? (
        <p className="failure" role="alert">{error}</p>
      ) : !raggs ? (
        <p className="muted">Loading…</p>
      ) : (
        <SortableGrid
          label="RAGGs"
          columns={LIST_COLUMNS}
          rows={raggs}
          rowKey={(r) => r.slug}
          initialSort={{ key: "created", dir: "desc" }}
          onRowClick={(r) => navigate(raggPath(r.slug), { from: "raggs" })}
        />
      )}
    </div>
  );
}

const RECIPE_COLUMNS: GridColumn<RaggRecipe>[] = [
  { key: "site", label: "Site", value: (r) => r.site, render: (r) => <strong>{r.site}</strong> },
  { key: "host", label: "Location", value: (r) => r.host },
  { key: "title", label: "Title", value: (r) => r.title },
  { key: "author", label: "Author", value: (r) => r.author },
  { key: "servings", label: "Serves", numeric: true, value: (r) => r.servings },
  { key: "minutes", label: "Minutes", numeric: true, value: (r) => r.minutes },
  { key: "lines", label: "Lines", numeric: true, value: (r) => r.lines },
  { key: "capturedAt", label: "Captured", value: (r) => r.capturedAt },
  {
    key: "url", label: "Source", value: (r) => r.url,
    render: (r) => (r.url
      ? <span className="url"><a href={r.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>{r.url}</a></span>
      : "—"),
  },
];

const TABS = [
  { id: "recipes", label: "Recipes" },
  { id: "comparison", label: "Comparison" },
  { id: "visualize", label: "Visualize" },
] as const;
type Tab = (typeof TABS)[number]["id"];
/** A RAGG opens on its recipes scaled to one weight of the primary ingredient — what the app is for. */
const LANDING: Tab = "visualize";

type Load = { slug: string; page: RaggPageData } | { slug: string; error: string };

interface RaggPageProps {
  slug: string;
  revision: number;
  /** Where Back goes when the page was opened by its address rather than from the list. */
  onLeave: () => void;
}

export function RaggPage({ slug, revision, onLeave }: RaggPageProps) {
  const [load, setLoad] = useState<Load | null>(null);
  const [tab, setTab] = useState<Tab>(LANDING);

  useEffect(() => {
    let stale = false;
    getJson<RaggPageData>(`/api/admin/ragg?slug=${encodeURIComponent(slug)}`)
      .then((page) => { if (!stale) setLoad({ slug, page }); })
      .catch((e: unknown) => { if (!stale) setLoad({ slug, error: e instanceof Error ? e.message : "Could not load the RAGG" }); });
    return () => { stale = true; };
  }, [slug, revision]);

  useEffect(() => setTab(LANDING), [slug]);

  const current = load?.slug === slug ? load : null;
  const page = current && "page" in current ? current.page : null;
  const back = () => ((history.state as { from?: string } | null)?.from ? history.back() : onLeave());
  const recipes = useMemo(() => page?.recipes ?? [], [page]);

  if (current && "error" in current) {
    return (
      <div className="pane">
        <p><button type="button" className="link" onClick={back}>← Back</button></p>
        <p className="failure" role="alert">{current.error}</p>
      </div>
    );
  }
  if (!page) return <div className="pane"><p className="muted">Loading…</p></div>;

  return (
    <div className="pane ragg">
      <header className="pane__head">
        <div>
          <p className="recipe__crumb"><button type="button" className="link" onClick={back}>← Back</button></p>
          <h2>{page.summary.name}</h2>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label={`${page.summary.name} tools`}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
            className={`tabs__tab ${tab === t.id ? "is-active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "recipes" ? (
        <SortableGrid
          label={`Recipes in ${page.summary.name}`}
          columns={RECIPE_COLUMNS}
          rows={recipes}
          rowKey={(r) => r.id}
          initialSort={{ key: "site", dir: "asc" }}
          onRowClick={(r) => navigate(recipePath(r.id), { from: "ragg" })}
        />
      ) : tab === "comparison" ? (
        <ComparisonView dish={slug} revision={revision} />
      ) : (
        <VisualizeView dish={slug} revision={revision} />
      )}
    </div>
  );
}
