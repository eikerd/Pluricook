/**
 * The comparison for one dish: what the recipes agree on, where they part, and
 * how salty each one is — every amount stated against the dish's anchor.
 */

import { useEffect, useMemo, useState } from "react";
import { SortableGrid, type GridColumn } from "./SortableGrid";
import type {
  Comparison, IngredientCluster, RecipeSummary, SalinityFlag, SourceAmount,
} from "../lib/compare";
import type { DishSummary } from "../lib/compare-service";

const WHOLE_RECIPE = "";

const FLAG_BADGE: Record<SalinityFlag, string> = {
  ok: "badge--go",
  high: "badge--stop",
  low: "badge--warn",
  unreliable: "badge--mute",
};

/** "detroit-pizza" → "Detroit pizza". */
const dishName = (slug: string) => {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const number = (n: number | null, dp = 1) =>
  n === null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: dp });

function clusterColumns(c: Comparison): GridColumn<IngredientCluster>[] {
  return [
    { key: "food", label: "Ingredient", value: (r) => r.foodDescription },
    { key: "klass", label: "Class", value: (r) => r.klass },
    {
      key: "recipes", label: "Recipes", numeric: true,
      value: (r) => r.recipeCount,
      render: (r) => `${r.recipeCount} / ${c.analysed}`,
    },
    {
      key: "relative", label: `Median ${c.anchor.unitLabel}`, numeric: true,
      value: (r) => r.medianRelative,
      render: (r) => <strong>{number(r.medianRelative, 2)}</strong>,
    },
    {
      key: "spread", label: "Spread", numeric: true,
      value: (r) => r.spreadRelative,
      render: (r) => (r.spreadRelative === null ? "—" : `${number(r.spreadRelative)}×`),
    },
    {
      key: "grams", label: "Median g", numeric: true,
      value: (r) => r.medianGrams,
      render: (r) => number(r.medianGrams),
    },
  ];
}

type Unmatched = Comparison["unmatched"][number];

// Row keys, at module scope so their identity is stable across renders. A
// cluster is one food; a salinity or source row is one recipe; an unmatched
// line needs its place too, since one recipe can list "salt, to taste" twice.
const byFood = (r: IngredientCluster) => String(r.fdcId);
const byRecipe = (r: { recipeId: string }) => r.recipeId;
const byRecipeAndPlace = (r: Unmatched, index: number) => `${r.recipeId}:${index}`;

/**
 * Only a web address becomes a link. assertProvenance already refuses anything
 * else at capture, but personal collections are JSON edited by hand, and an
 * href is the one place a "javascript:" string would run.
 */
function webUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

function sourceLink(siteName: string, sourceUrl: string | null) {
  const href = webUrl(sourceUrl);
  if (!href) return siteName;
  return (
    <span className="url"><a href={href} target="_blank" rel="noopener noreferrer">{siteName}</a></span>
  );
}

/** One ingredient, opened: each site's line as published, and what it came to. */
function sourceColumns(c: Comparison): GridColumn<SourceAmount>[] {
  return [
    { key: "source", label: "Source", value: (r) => r.siteName, render: (r) => sourceLink(r.siteName, r.sourceUrl) },
    { key: "line", label: "As published", value: (r) => r.rawLine },
    {
      key: "grams", label: "Grams", numeric: true,
      value: (r) => r.grams,
      render: (r) => <strong>{number(r.grams)}</strong>,
    },
    {
      key: "relative", label: c.anchor.unitLabel, numeric: true,
      value: (r) => r.relative,
      render: (r) => number(r.relative, 2),
    },
    { key: "basis", label: "Converted by", value: (r) => r.basis },
  ];
}

const UNMATCHED_COLUMNS: GridColumn<Unmatched>[] = [
  { key: "source", label: "Source", value: (r) => r.siteName },
  { key: "line", label: "As published", value: (r) => r.rawLine },
  { key: "basis", label: "Reason", value: (r) => r.basis },
];

function salinityColumns(c: Comparison): GridColumn<RecipeSummary>[] {
  return [
    {
      key: "source", label: "Source",
      value: (r) => r.siteName,
      render: (r) => sourceLink(r.siteName, r.sourceUrl),
    },
    {
      key: "salinity", label: `Salt ${c.anchor.unitLabel}`, numeric: true,
      value: (r) => r.salinityRelative,
      render: (r) => <strong>{number(r.salinityRelative, 2)}</strong>,
    },
    {
      key: "flag", label: "Flag",
      value: (r) => r.salinityFlag,
      render: (r) => <span className={`badge ${FLAG_BADGE[r.salinityFlag]}`}>{r.salinityFlag}</span>,
    },
    {
      key: "saltGrams", label: "Salt-equivalent g", numeric: true,
      value: (r) => r.saltEquivalentGrams,
      render: (r) => number(r.saltEquivalentGrams),
    },
    {
      key: "sodium", label: "Sodium mg", numeric: true,
      value: (r) => r.sodiumMg,
      render: (r) => number(r.sodiumMg, 0),
    },
    {
      key: "anchorGrams", label: "Anchor g", numeric: true,
      value: (r) => r.anchorGrams,
      render: (r) => number(r.anchorGrams, 0),
    },
    {
      key: "lines", label: "Lines resolved", numeric: true,
      value: (r) => (r.totalLines === 0 ? null : r.resolvedLines / r.totalLines),
      render: (r) => `${r.resolvedLines} / ${r.totalLines}`,
    },
    {
      key: "perServing", label: "Sodium mg / serving", numeric: true,
      value: (r) => r.sodiumMgPerServing,
      render: (r) => number(r.sodiumMgPerServing, 0),
    },
    {
      key: "dailyValue", label: "Daily value %", numeric: true,
      value: (r) => r.sodiumDailyValueShare,
      render: (r) => (r.sodiumDailyValueShare === null ? "—" : number(r.sodiumDailyValueShare * 100, 0)),
    },
  ];
}

export function ComparisonView() {
  const [dishes, setDishes] = useState<DishSummary[] | null>(null);
  const [dish, setDish] = useState<string | null>(null);
  const [section, setSection] = useState(WHOLE_RECIPE);
  // The answer is kept with the question it answers, so the page can tell when
  // what is on screen no longer matches what the pickers say.
  const [loaded, setLoaded] = useState<{ question: string; comparison: Comparison } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const question = `${dish ?? ""}\n${section}`;
  const comparison = loaded?.comparison ?? null;
  const isStale = loaded !== null && loaded.question !== question;

  useEffect(() => {
    fetch("/api/admin/dishes")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const list = (await r.json()) as DishSummary[];
        setDishes(list);
        setDish((current) => current ?? list[0]?.dish ?? null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not list dishes"));
  }, []);

  useEffect(() => {
    if (!dish) return;
    let stale = false;
    const query = section === WHOLE_RECIPE ? "" : `?section=${encodeURIComponent(section)}`;

    fetch(`/api/admin/compare/${dish}${query}`)
      .then(async (r) => {
        const body = (await r.json()) as Comparison | { error: string };
        if (!r.ok) throw new Error("error" in body ? body.error : `HTTP ${r.status}`);
        if (!stale) { setLoaded({ question, comparison: body as Comparison }); setError(null); }
      })
      .catch((e: unknown) => {
        if (!stale) setError(e instanceof Error ? e.message : "Comparison failed");
      });

    // A slow answer for the previous dish must not overwrite the current one.
    return () => { stale = true; };
  }, [dish, section, question]);

  // Built once per answer. Rebuilt on every render, fresh column arrays would
  // make each open row's nested grid re-sort whenever the outer grid changed.
  const columns = useMemo(
    () =>
      comparison && {
        cluster: clusterColumns(comparison),
        salinity: salinityColumns(comparison),
        source: sourceColumns(comparison),
      },
    [comparison],
  );

  const sections = useMemo(
    () => dishes?.find((d) => d.dish === dish)?.sections ?? [],
    [dishes, dish],
  );

  const pickDish = (next: string) => {
    setDish(next);
    setSection(WHOLE_RECIPE);   // sections belong to a dish; "sauce" means nothing for meatloaf
    setLoaded(null);
  };

  const sourcesOf = (cluster: IngredientCluster) =>
    columns && (
      <SortableGrid
        label={`Sources for ${cluster.foodDescription}`}
        columns={columns.source}
        rows={cluster.sources}
        rowKey={byRecipe}
        initialSort={{ key: "relative", dir: "desc" }}
      />
    );

  if (error) {
    return (
      <div className="pane">
        <header className="pane__head"><div><h2>Something broke</h2></div></header>
        <p className="failure">{error}</p>
      </div>
    );
  }

  return (
    <div className="pane">
      <header className="pane__head">
        <div>
          <h2>Comparison</h2>
          {comparison && comparison.analysed > 0 && (
            <p className="muted pane__note stale-aware" data-pending={isStale || undefined}>
              {comparison.anchor.reason}
            </p>
          )}
        </div>
        <div className="pickers">
          <select
            className="picker"
            aria-label="Dish"
            value={dish ?? ""}
            onChange={(e) => pickDish(e.target.value)}
          >
            {(dishes ?? []).map((d) => (
              <option key={d.dish} value={d.dish}>{dishName(d.dish)}</option>
            ))}
          </select>

          {sections.length > 0 && (
            <select
              className="picker"
              aria-label="Section"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            >
              <option value={WHOLE_RECIPE}>Whole recipe</option>
              {sections.map((s) => (
                <option key={s} value={s}>{dishName(s)}</option>
              ))}
            </select>
          )}
        </div>
      </header>

      {!comparison || !columns ? (
        <p className="muted">Loading…</p>
      ) : comparison.analysed === 0 ? (
        <p className="empty">No recipes to compare.</p>
      ) : (
        // Keyed by dish and section so each grid starts from its default sort
        // when the question changes, rather than carrying over the last one.
        // Dimmed while a new section loads: old numbers under a new section name
        // are the one thing a comparison page must never show at full strength.
        <div key={loaded?.question} className="stale-aware" data-pending={isStale || undefined}>
          <h3 className="pane__sub">Consensus</h3>
          <SortableGrid
            label="Consensus"
            columns={columns.cluster}
            rows={comparison.common}
            rowKey={byFood}
            initialSort={{ key: "recipes", dir: "desc" }}
            detail={sourcesOf}
          />

          <h3 className="pane__sub">Salinity</h3>
          <SortableGrid
            label="Salinity"
            columns={columns.salinity}
            rows={comparison.recipes}
            rowKey={byRecipe}
            initialSort={{ key: "salinity", dir: "desc" }}
          />

          <h3 className="pane__sub">Outliers</h3>
          <SortableGrid
            label="Outliers"
            columns={columns.cluster}
            rows={comparison.outliers}
            rowKey={byFood}
            initialSort={{ key: "recipes", dir: "desc" }}
            detail={sourcesOf}
          />

          {comparison.unmatched.length > 0 && (
            <>
              <h3 className="pane__sub">Unmatched lines</h3>
              <SortableGrid
                label="Unmatched lines"
                columns={UNMATCHED_COLUMNS}
                rows={comparison.unmatched}
                rowKey={byRecipeAndPlace}
                initialSort={{ key: "source", dir: "asc" }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
