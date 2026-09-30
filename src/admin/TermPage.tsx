/**
 * One search term's landing page, at /terms/<slug>: the term's own fields, and
 * the recipes attached to it — the Recipes table's columns, each row opening
 * its recipe.
 */

import { useEffect, useMemo, useState } from "react";
import type { TermPageData } from "../lib/admin-queries";
import { cellContent } from "./DataTable";
import { Fields } from "./Fields";
import { navigate, recipePath } from "./route";
import { SortableGrid, type GridColumn, type SortValue } from "./SortableGrid";

type Recipe = Record<string, unknown>;

interface TermPageProps {
  slug: string;
  /** Where Back goes when the page was opened by its address rather than from the admin. */
  onLeave: () => void;
}

type Load = { slug: string; page: TermPageData } | { slug: string; error: string };

const sortValue = (v: unknown): SortValue => (typeof v === "number" || typeof v === "string" ? v : null);

export function TermPage({ slug, onLeave }: TermPageProps) {
  const [load, setLoad] = useState<Load | null>(null);

  useEffect(() => {
    let stale = false;
    fetch(`/api/admin/term?slug=${encodeURIComponent(slug)}`)
      .then(async (r) => {
        const body = (await r.json()) as TermPageData | { error: string };
        if (!r.ok) throw new Error("error" in body ? body.error : `HTTP ${r.status}`);
        if (!stale) setLoad({ slug, page: body as TermPageData });
      })
      .catch((e: unknown) => { if (!stale) setLoad({ slug, error: e instanceof Error ? e.message : "Could not load the term" }); });
    return () => { stale = true; };
  }, [slug]);

  const current = load?.slug === slug ? load : null;
  const page = current && "page" in current ? current.page : null;

  const columns = useMemo<GridColumn<Recipe>[]>(
    () => (page?.columns ?? []).map((c) => ({
      key: c.key,
      label: c.label,
      numeric: c.numeric,
      value: (r) => sortValue(r[c.key]),
      render: (r) => cellContent(c, r[c.key]),
    })),
    [page],
  );

  const back = () => ((history.state as { from?: string } | null)?.from ? history.back() : onLeave());

  if (current && "error" in current) {
    return (
      <div className="pane">
        <p><button type="button" className="link" onClick={back}>← Back</button></p>
        <p className="failure" role="alert">{current.error}</p>
      </div>
    );
  }
  if (!page) return <div className="pane"><p className="muted">Loading…</p></div>;

  const { term, recipes } = page;
  const fields: Array<[string, string | number | null]> = [
    ["Rank", term.rank],
    ["Group", term.group],
    ["Slug", term.slug],
    ...(term.aliases?.length ? [["Aliases", term.aliases.join(", ")] as [string, string]] : []),
    ...(term.note ? [["Note", term.note] as [string, string]] : []),
  ];

  return (
    <div className="pane term">
      <header className="pane__head">
        <div>
          <p className="recipe__crumb">
            <button type="button" className="link" onClick={back}>← Back</button>
          </p>
          <h2>{term.term}</h2>
        </div>
      </header>

      <div className="detail__cards">
        <section className="detail__card">
          <h3 className="recipe__section-name">Term</h3>
          <Fields rows={fields} />
        </section>
      </div>

      <section className="detail__sheet">
        <h3 className="recipe__section-name">Recipes</h3>
        {recipes.length ? (
          <SortableGrid
            label="Recipes"
            columns={columns}
            rows={recipes}
            rowKey={(r) => String(r.id)}
            initialSort={{ key: "site", dir: "asc" }}
            onRowClick={(r) => navigate(recipePath(String(r.id)), { from: "term" })}
          />
        ) : (
          <p className="muted">None.</p>
        )}
      </section>
    </div>
  );
}
