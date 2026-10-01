/**
 * One recipe's page, at /recipes/<id>: the recipe as a spreadsheet you edit in
 * place. Each cell saves when you leave it. For a captured recipe the edit is a
 * correction beside the published one (data/corrections/<dish>.json), never
 * over it, and the page can show the published version beside the corrected
 * one; the owner's own copy is edited directly.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { RecipePageData } from "../lib/compare-service";
import type { RecipeFacts } from "../lib/recipe-detail";
import { correctionFrom, draftFrom, fullCorrection, type Draft } from "./recipe-draft";
import { RecipeLines } from "./RecipeLines";
import { navigate, raggPath, recipePath } from "./route";

interface RecipePageProps {
  id: string;
  /** Where Back goes when the page was opened by its address rather than from the admin. */
  onLeave: () => void;
  /**
   * Called once the server holds a change — a correction saved or reverted, a
   * copy made or deleted — so the views kept under this page read it again.
   */
  onChanged: () => void;
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

export function RecipePage({ id, onLeave, onChanged }: RecipePageProps) {
  const [load, setLoad] = useState<Load | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showPublished, setShowPublished] = useState(false);
  // Saves go out one at a time, in the order they were made, and only the
  // answer to the latest one is shown — an earlier answer would put back lines
  // the owner has edited since.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(0);
  // Whether the server holds a correction, counting saves still on their way.
  const corrected = useRef(false);
  // The line clicked on a chart, carried in the history entry that opened this page.
  const highlight = (history.state as { line?: string } | null)?.line ?? null;

  const show = (page: RecipePageData) => {
    setLoad({ id, page });
    setDraft(draftFrom(page.detail));
    corrected.current = page.correction !== null;
  };

  useEffect(() => {
    let stale = false;
    setShowPublished(false);
    setSaveError(null);
    fetch(`/api/admin/recipe?id=${encodeURIComponent(id)}`)
      .then(async (r) => {
        const body = (await r.json()) as RecipePageData | { error: string };
        if (!r.ok) throw new Error("error" in body ? body.error : `HTTP ${r.status}`);
        if (!stale) show(body as RecipePageData);
      })
      .catch((e: unknown) => { if (!stale) setLoad({ id, error: e instanceof Error ? e.message : "Could not load the recipe" }); });
    return () => { stale = true; };
    // show only closes over id, which this effect already follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const current = load?.id === id ? load : null;
  const page = current && "page" in current ? current.page : null;
  const published = useMemo(
    () => (page?.correction ? new Set(page.published.sections.flatMap((s) => s.lines)) : null),
    [page],
  );

  const send = (method: "PUT" | "DELETE", correction?: Record<string, unknown>) => {
    const mine = ++latest.current;
    corrected.current = method === "PUT";
    setSaving(true);
    setSaveError(null);
    queue.current = queue.current.then(async () => {
      try {
        const r = await fetch(`/api/admin/recipe/correction?id=${encodeURIComponent(id)}`, {
          method,
          headers: correction ? { "content-type": "application/json" } : undefined,
          body: correction ? JSON.stringify(correction) : undefined,
        });
        const body = (await r.json()) as RecipePageData | { error: string };
        if (!r.ok) throw new Error("error" in body ? body.error : `HTTP ${r.status}`);
        if (mine === latest.current) show(body as RecipePageData);
        onChanged();
      } catch (e) {
        if (mine === latest.current) setSaveError(e instanceof Error ? e.message : "The change could not be saved");
      } finally {
        if (mine === latest.current) setSaving(false);
      }
    });
  };

  /** One cell left with a new value: save the whole recipe as it now stands. */
  const commit = (next: Draft) => {
    if (!page) return;
    setDraft(next);
    // The owner's copy is written whole: its stored self may be a save behind.
    if (page.copy) {
      send("PUT", fullCorrection(next));
      return;
    }
    const correction = correctionFrom(next, page.published);
    if (correction !== null) send("PUT", correction);
    // Back to exactly the published recipe: that is no correction, so drop it.
    else if (corrected.current) send("DELETE");
  };

  const back = () => ((history.state as { from?: string } | null)?.from ? history.back() : onLeave());

  /** Make the owner their own copy, and open it. */
  const clone = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`/api/admin/recipe/clone?id=${encodeURIComponent(id)}`, { method: "POST" });
      const body = (await r.json()) as { id?: string; error?: string };
      if (!r.ok || !body.id) throw new Error(body.error ?? `HTTP ${r.status}`);
      onChanged();
      navigate(recipePath(body.id), { from: "recipe" });
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
      onChanged();
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
  if (!page || !draft) return <div className="pane"><p className="muted">Loading…</p></div>;

  const { detail, correction, copy } = page;

  return (
    <div className="pane recipe">
      <header className="pane__head">
        <div>
          <p className="recipe__crumb">
            <button type="button" className="link" onClick={back}>← Back</button>
            <span className="muted"> · </span>
            <button type="button" className="link" onClick={() => navigate(raggPath(page.dish), { from: "recipe" })}>
              {dishName(page.dish)}
            </button>
          </p>
          <h2>{detail.siteName}</h2>
          {detail.sourceUrl && <a href={detail.sourceUrl} target="_blank" rel="noreferrer noopener">Open the source</a>}
        </div>
        <div className="recipe__actions">
          {copy ? (
            <button type="button" className="button button--quiet" disabled={saving} onClick={() => void deleteCopy()}>Delete this copy</button>
          ) : (
            <button type="button" className="button button--quiet" disabled={saving} onClick={() => void clone()}>Clone</button>
          )}
        </div>
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

      {correction && (
        <div className="notice">
          <span>Corrected {correction.correctedAt}. The comparison uses this version.</span>
          <button type="button" className="link" onClick={() => setShowPublished((v) => !v)}>
            {showPublished ? "Hide the published version" : "Show the published version"}
          </button>
          <button type="button" className="link" disabled={saving}
            onClick={() => { if (window.confirm("Drop your corrections and read this recipe as published?")) send("DELETE"); }}>
            Revert to published
          </button>
        </div>
      )}
      {saveError && <p className="failure" role="alert">{saveError}</p>}

      <RecipeLines detail={detail} draft={draft} pending={saving} onCommit={commit} highlight={highlight} published={published} />

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
    </div>
  );
}
