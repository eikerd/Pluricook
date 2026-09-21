/**
 * Seven ways of looking at one dish, side by side until one proves the most
 * useful. All of them read the same payload, /api/admin/matrix, so no two can
 * disagree about a number — and a click on any mark shows the line behind it.
 */

import { useEffect, useMemo, useState } from "react";
import type { DishSummary } from "../lib/compare-service";
import type { VisualMatrix } from "../lib/visual-matrix";
import { Network } from "./charts/Network";
import { UpSet } from "./charts/UpSet";
import { Distribution, Heatmap, Map3D, Parallel, recipeLabel, Ternary, type Picked, type ViewProps } from "./charts/views";

const WHOLE_RECIPE = "";

const VIEWS: Array<{ id: string; label: string; View: (p: ViewProps) => React.ReactNode }> = [
  { id: "heatmap", label: "Heatmap", View: Heatmap },
  { id: "distribution", label: "Distribution", View: Distribution },
  { id: "parallel", label: "Parallel", View: Parallel },
  { id: "upset", label: "UpSet", View: UpSet },
  { id: "map3d", label: "3D map", View: Map3D },
  { id: "network", label: "3D network", View: Network },
  { id: "ternary", label: "Ternary", View: Ternary },
];

const dishName = (slug: string) => {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

type Outcome =
  | { kind: "answer"; question: string; m: VisualMatrix }
  | { kind: "failure"; question: string; message: string };

export function VisualizeView() {
  const [dishes, setDishes] = useState<DishSummary[] | null>(null);
  const [dish, setDish] = useState<string | null>(null);
  const [section, setSection] = useState(WHOLE_RECIPE);
  const [view, setView] = useState("heatmap");
  const [focus, setFocus] = useState<number | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const question = `${dish ?? ""}\n${section}`;
  const m = outcome?.kind === "answer" && outcome.question === question ? outcome.m : null;
  const error = listError ?? (outcome?.kind === "failure" && outcome.question === question ? outcome.message : null);

  useEffect(() => {
    fetch("/api/admin/dishes")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const list = (await r.json()) as DishSummary[];
        setDishes(list);
        setDish((d) => d ?? list[0]?.dish ?? null);
      })
      .catch((e: unknown) => setListError(e instanceof Error ? e.message : "Could not list dishes"));
  }, []);

  useEffect(() => {
    if (!dish) return;
    let stale = false;
    const query = section === WHOLE_RECIPE ? "" : `?section=${encodeURIComponent(section)}`;
    fetch(`/api/admin/matrix/${dish}${query}`)
      .then(async (r) => {
        const body = (await r.json()) as VisualMatrix | { error: string };
        if (!r.ok) throw new Error("error" in body ? body.error : `HTTP ${r.status}`);
        if (!stale) setOutcome({ kind: "answer", question, m: body as VisualMatrix });
      })
      .catch((e: unknown) => {
        if (!stale) setOutcome({ kind: "failure", question, message: e instanceof Error ? e.message : "Could not load" });
      });
    return () => { stale = true; };
  }, [dish, section, question]);

  // A new question invalidates anything that pointed into the old matrix.
  useEffect(() => { setFocus(null); setPicked(null); }, [question]);

  const sections = useMemo(() => dishes?.find((d) => d.dish === dish)?.sections ?? [], [dishes, dish]);
  const Active = VIEWS.find((v) => v.id === view)!.View;

  return (
    <div className="pane">
      <header className="pane__head">
        <div>
          <h2>Visualize</h2>
          {m && <p className="muted pane__note">{m.normalization.reason}</p>}
        </div>
        <div className="pickers">
          <select className="picker" aria-label="Dish" value={dish ?? ""} onChange={(e) => { setDish(e.target.value); setSection(WHOLE_RECIPE); }}>
            {(dishes ?? []).map((d) => <option key={d.dish} value={d.dish}>{dishName(d.dish)}</option>)}
          </select>
          {sections.length > 0 && (
            <select className="picker" aria-label="Section" value={section} onChange={(e) => setSection(e.target.value)}>
              <option value={WHOLE_RECIPE}>Whole recipe</option>
              {sections.map((s) => <option key={s} value={s}>{dishName(s)}</option>)}
            </select>
          )}
          {m && (
            <select className="picker" aria-label="Baseline" value={focus ?? ""}
              onChange={(e) => setFocus(e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">Against the median</option>
              {m.recipes.map((r, i) => <option key={r.recipeId} value={i}>Against {r.siteName}</option>)}
            </select>
          )}
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Visualization">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={view === v.id}
            className={`tabs__tab ${view === v.id ? "is-active" : ""}`} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </nav>

      {error ? (
        <p className="failure" role="alert">{error}</p>
      ) : !m ? (
        <p className="muted">Loading…</p>
      ) : m.recipes.length === 0 ? (
        <p className="empty">No recipes to compare.</p>
      ) : (
        <>
          {m.normalization.kind === "clr" && (
            <p className="failure">No anchor for this dish: amounts are centred log-ratios, not a percentage of anything.</p>
          )}
          {m.recipes.some((r) => r.unknownLines > 0) && (
            <p className="muted legend">⚠ n — n lines of this recipe never resolved to grams, so it may hold ingredients shown here as absent.</p>
          )}
          <section className="viz" key={`${question}\n${view}`}>
            <Active m={m} focus={focus} onPick={setPicked} />
          </section>
          {picked && m.values[picked.recipe] && (
            <aside className="checked" aria-live="polite">
              <strong>{recipeLabel(m, picked.recipe)}</strong> · {m.ingredients[picked.ingredient]!.label} —{" "}
              {m.lines[picked.recipe]![picked.ingredient] ? (
                <>“{m.lines[picked.recipe]![picked.ingredient]}” = <strong>{m.grams[picked.recipe]![picked.ingredient]} g</strong>,{" "}
                  <strong>{m.values[picked.recipe]![picked.ingredient]}</strong> {m.unitLabel}</>
              ) : <>not listed</>}
              <button type="button" className="checked__close" aria-label="Close" onClick={() => setPicked(null)}>×</button>
            </aside>
          )}
        </>
      )}
    </div>
  );
}
