/**
 * One recipe's page, at /recipes/<id>: every line as the comparison reads it,
 * and, in Edit, the owner's corrections. A correction is saved beside the
 * published recipe (data/corrections/<dish>.json), never over it, and the page
 * can show the published version beside the corrected one.
 */

import { useEffect, useMemo, useState } from "react";
import type { RecipePageData } from "../lib/compare-service";
import type { RecipeFacts } from "../lib/recipe-detail";
import { RecipeEditor } from "./RecipeEditor";
import { RecipeLines } from "./RecipeLines";
import { navigate, recipePath } from "./route";

interface RecipePageProps {
  id: string;
  /** Where Back goes when the page was opened by its address rather than from the admin. */
  onLeave: () => void;
}

type Load = { id: string; page: RecipePageData } | { id: string; error: string };

const dishName = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ");

function factsLine(f: RecipeFacts): string {
  const parts = [
    f.servings !== null && `Serves ${f.servings}`,
    f.prepTimeMinutes !== null && `Prep ${f.prepTimeMinutes} min`,
    f.cookTimeMinutes !== null && `Cook ${f.cookTimeMinutes} min`,
    f.totalTimeMinutes !== null && `Total ${f.totalTimeMinutes} min`,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function RecipePage({ id, onLeave }: RecipePageProps) {
  const [load, setLoad] = useState<Load | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showPublished, setShowPublished] = useState(false);
  // The line clicked on a chart, carried in the history entry that opened this page.
  const highlight = (history.state as { line?: string } | null)?.line ?? null;

  useEffect(() => {
    let stale = false;
    setEditing(false);
    setShowPublished(false);
    fetch(`/api/admin/recipe?id=${encodeURIComponent(id)}`)
      .then(async (r) => {
        const body = (await r.json()) as RecipePageData | { error: string };
        if (!r.ok) throw new Error("error" in body ? body.error : `HTTP ${r.status}`);
        if (stale) return;
        setLoad({ id, page: body as RecipePageData });
        // A copy made a moment ago opens ready to edit.
        if ((history.state as { edit?: boolean } | null)?.edit) setEditing(true);
      })
      .catch((e: unknown) => { if (!stale) setLoad({ id, error: e instanceof Error ? e.message : "Could not load the recipe" }); });
    return () => { stale = true; };
  }, [id]);

  const current = load?.id === id ? load : null;
  const page = current && "page" in current ? current.page : null;
  const published = useMemo(
    () => (page?.correction ? new Set(page.published.sections.flatMap((s) => s.lines)) : null),
    [page],
  );

  const send = async (method: "PUT" | "DELETE", correction?: Record<string, unknown>) => {
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`/api/admin/recipe/correction?id=${encodeURIComponent(id)}`, {
        method,
        headers: correction ? { "content-type": "application/json" } : undefined,
        body: correction ? JSON.stringify(correction) : undefined,
      });
      const body = (await r.json()) as RecipePageData | { error: string };
      if (!r.ok) throw new Error("error" in body ? body.error : `HTTP ${r.status}`);
      setLoad({ id, page: body as RecipePageData });
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "The change could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const save = (correction: Record<string, unknown> | null) => {
    // Back to exactly the published recipe: that is no correction, so drop it.
    if (correction === null) {
      if (page?.correction) void send("DELETE");
      else setEditing(false);
      return;
    }
    void send("PUT", correction);
  };

  const back = () => ((history.state as { from?: string } | null)?.from ? history.back() : onLeave());

  /** Make the owner their own copy, and open it ready to edit. */
  const clone = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`/api/admin/recipe/clone?id=${encodeURIComponent(id)}`, { method: "POST" });
      const body = (await r.json()) as { id?: string; error?: string };
      if (!r.ok || !body.id) throw new Error(body.error ?? `HTTP ${r.status}`);
      navigate(recipePath(body.id), { from: "recipe", edit: true });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "The copy could not be made");
    } finally {
      setSaving(false);
    }
  };

  const deleteCopy = async () => {
    if (!window.confirm("Delete your copy? The recipe it began as stays.")) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`/api/admin/recipe/clone?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? `HTTP ${r.status}`);
      onLeave();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "The copy could not be deleted");
      setSaving(false);
    }
  };

  if (current && "error" in current) {
    return (
      <div className="pane">
        <p><button type="button" className="link" onClick={back}>← Back</button></p>
        <p className="failure" role="alert">{current.error}</p>
      </div>
    );
  }
  if (!page) return <div className="pane"><p className="muted">Loading…</p></div>;

  const { detail, correction, copy } = page;
  const facts = factsLine(detail.facts);

  return (
    <div className="pane recipe">
      <header className="pane__head">
        <div>
          <p className="recipe__crumb">
            <button type="button" className="link" onClick={back}>← Back</button>
            <span className="muted"> · {dishName(page.dish)}</span>
          </p>
          <h2>{detail.siteName}</h2>
          <p className="muted pane__note">{detail.sourceTitle}{detail.author ? ` · ${detail.author}` : ""}</p>
          {detail.sourceUrl && <a href={detail.sourceUrl} target="_blank" rel="noreferrer noopener">Open the source</a>}
          {facts && <p className="pane__note">{facts}</p>}
        </div>
        {!editing && (
          <div className="recipe__actions">
            {copy ? (
              <button type="button" className="button button--quiet" disabled={saving} onClick={() => void deleteCopy()}>Delete this copy</button>
            ) : (
              <button type="button" className="button button--quiet" disabled={saving} onClick={() => void clone()}>Clone</button>
            )}
            <button type="button" className="button" disabled={saving} onClick={() => { setSaveError(null); setEditing(true); }}>Edit</button>
          </div>
        )}
      </header>

      {copy && (
        <div className="notice">
          <span>
            Your own copy{copy.originalSiteName ? ` of ${copy.originalSiteName}'s recipe` : ""}. Edits change this copy only.
          </span>
          {copy.clonedFrom && copy.originalSiteName && (
            <button type="button" className="link" onClick={() => navigate(recipePath(copy.clonedFrom!), { from: "recipe" })}>
              Open the original
            </button>
          )}
        </div>
      )}

      {correction && !editing && (
        <div className="notice">
          <span>Corrected {correction.correctedAt}. The comparison uses this version.</span>
          <button type="button" className="link" onClick={() => setShowPublished((v) => !v)}>
            {showPublished ? "Hide the published version" : "Show the published version"}
          </button>
          <button type="button" className="link" disabled={saving}
            onClick={() => { if (window.confirm("Drop your corrections and read this recipe as published?")) void send("DELETE"); }}>
            Revert to published
          </button>
        </div>
      )}
      {saveError && !editing && <p className="failure" role="alert">{saveError}</p>}

      {editing ? (
        <RecipeEditor page={page} saving={saving} error={saveError} onSave={save} onCancel={() => setEditing(false)} />
      ) : (
        <>
          <RecipeLines detail={detail} highlight={highlight} published={published} />
          {showPublished && correction && (
            <section className="recipe__published">
              <h3 className="recipe__section-name">As published</h3>
              <p className="muted pane__note">
                {page.published.sourceTitle}{page.published.author ? ` · ${page.published.author}` : ""}
                {page.published.sourceUrl ? ` · ${page.published.sourceUrl}` : ""}
              </p>
              {factsLine(page.published.facts) && <p className="pane__note">{factsLine(page.published.facts)}</p>}
              {page.published.sections.map((s, k) => (
                <div key={s.name ?? k}>
                  {s.name && <h4 className="recipe__published-name">{dishName(s.name)}</h4>}
                  <ul className="recipe__published-lines">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
