/**
 * The Plotly-drawn views. Each reads the one VisualMatrix and nothing else.
 *
 * Shared rules: unknown is never drawn as absent (rows with unresolved lines are
 * marked ⚠); every mark can be clicked through to the line as published.
 */

import { useMemo, useState } from "react";
import { diffCell, type VisualMatrix } from "../../lib/visual-matrix";
import { classicalMds } from "./mds";
import { COLORWAY, DIVERGING, LINE, PAPRIKA, Plot, type PlotClick } from "./Plot";

export interface Picked { recipe: number; ingredient: number }

export interface ViewProps {
  m: VisualMatrix;
  /** The recipe held up for comparison, or null for the corpus median. */
  focus: number | null;
  onPick: (p: Picked) => void;
}

export const recipeLabel = (m: VisualMatrix, i: number) =>
  `${m.recipes[i]!.siteName}${m.recipes[i]!.unknownLines > 0 ? ` ⚠${m.recipes[i]!.unknownLines}` : ""}`;

/** Ingredients enough recipes list for a per-ingredient axis to mean something. */
const shared = (m: VisualMatrix, min = 3) =>
  m.ingredients.map((_, j) => j).filter((j) => !m.ingredients[j]!.isAnchor && m.ingredients[j]!.recipeCount >= Math.min(min, m.recipes.length));

// ── 1. Heatmap against a baseline ───────────────────────────────────────────

export function Heatmap({ m, focus, onPick }: ViewProps) {
  const { data, layout, order } = useMemo(() => {
    const base = m.ingredients.map((ing, j) => (focus === null ? ing.median : m.values[focus]![j]!));
    // Nearest to the baseline first, so small differences sit together.
    const order = m.recipes.map((_, i) => i).sort((a, b) =>
      focus === null ? 0 : (m.sharedDistance[focus]![a] ?? 99) - (m.sharedDistance[focus]![b] ?? 99));

    const z: Array<Array<number | null>> = [], text: string[][] = [];
    for (const i of order) {
      const zr: Array<number | null> = [], tr: string[] = [];
      m.ingredients.forEach((_, j) => {
        const v = m.values[i]![j]!, g = m.grams[i]![j]!;
        // Listed, but this recipe lacks the anchor class, so there is no ratio to
        // compare: show the grams, never "removed".
        if (v === null && g !== null) { zr.push(null); tr.push(`${g} g`); return; }
        const d = diffCell(v, base[j]!);
        zr.push(d.kind === "same-basis" ? Math.max(-2, Math.min(2, d.log2)) : null);
        tr.push(d.kind === "added" ? `+${v}` : d.kind === "removed" ? "−" : v === null ? "" : String(v));
      });
      z.push(zr); text.push(tr);
    }
    return {
      order,
      data: [{
        type: "heatmap", z, text, texttemplate: "%{text}", textfont: { size: 11 },
        x: m.ingredients.map((g) => g.label), y: order.map((i) => recipeLabel(m, i)),
        colorscale: DIVERGING, zmin: -2, zmax: 2, xgap: 2, ygap: 2, hoverongaps: false,
        colorbar: { title: { text: "× baseline" }, tickvals: [-2, -1, 0, 1, 2], ticktext: ["¼", "½", "1", "2", "4"] },
        hovertemplate: "%{y}<br>%{x}: %{text}<extra></extra>",
      }],
      layout: {
        margin: { l: 190, r: 20, t: 10, b: 150 }, xaxis: { tickangle: -40 },
        yaxis: { autorange: "reversed" }, plot_bgcolor: "#f4ead7",
      },
    };
  }, [m, focus]);

  const click = (p: PlotClick) => {
    const j = m.ingredients.findIndex((g) => g.label === p.x);
    const row = order.find((i) => recipeLabel(m, i) === p.y);
    if (j >= 0 && row !== undefined) onPick({ recipe: row, ingredient: j });
  };
  return <Plot label="Heatmap of each recipe against the baseline" data={data} layout={layout}
    height={140 + 34 * m.recipes.length + 150} onPointClick={click} />;
}

// ── 2. Distributions ────────────────────────────────────────────────────────

export function Distribution({ m, focus, onPick }: ViewProps) {
  const cols = useMemo(() => shared(m), [m]);
  const { data, layout } = useMemo(() => {
    // Against each ingredient's median, on a log axis: water at 70 and yeast at
    // 1.7 then share one scale, and "double" sits as far up as "half" sits down.
    const data = cols.map((j) => {
      const med = m.ingredients[j]!.median ?? 1;
      const rows = m.recipes.map((_, i) => i).filter((i) => m.values[i]![j] != null);
      return {
        type: "box", name: m.ingredients[j]!.label, boxpoints: "all", jitter: 0.35, pointpos: 0,
        y: rows.map((i) => m.values[i]![j]! / med),
        text: rows.map((i) => `${recipeLabel(m, i)}: ${m.values[i]![j]}`),
        customdata: rows.map((i) => [i, j]), hovertemplate: "%{text}<extra></extra>",
        line: { color: "#6d5c52", width: 1 }, fillcolor: "rgba(0,0,0,0)",
        marker: { size: rows.map((i) => (i === focus ? 13 : 7)), color: rows.map((i) => (i === focus ? PAPRIKA : "#6d5c52")) },
      };
    });
    return {
      data,
      layout: {
        showlegend: false, margin: { l: 60, r: 20, t: 10, b: 130 }, xaxis: { tickangle: -40 },
        yaxis: { type: "log", title: { text: "× median" }, gridcolor: LINE, tickvals: [0.25, 0.5, 1, 2, 4], ticktext: ["¼", "½", "1", "2", "4"] },
      },
    };
  }, [m, cols, focus]);

  const click = (p: PlotClick) => {
    const c = p.customdata as [number, number] | undefined;
    if (c) onPick({ recipe: c[0], ingredient: c[1] });
  };
  if (cols.length === 0) return <p className="empty">No ingredient is shared by enough recipes to chart.</p>;
  return <Plot label="Distribution of each ingredient across recipes" data={data} layout={layout} onPointClick={click} />;
}

// ── 3. Parallel coordinates ─────────────────────────────────────────────────

export function Parallel({ m, focus }: ViewProps) {
  const cols = useMemo(() => shared(m), [m]);
  // A recipe without the anchor class has no ratios; drawn, it would sit on every
  // "not listed" floor as though it listed nothing. It is left out instead.
  const rows = useMemo(() => m.recipes.map((_, i) => i).filter((i) => m.values[i]!.some((v) => v != null)), [m]);
  const { data, layout } = useMemo(() => ({
    data: [{
      type: "parcoords",
      // A line is one recipe. Plotly cannot draw a gap, so an unlisted ingredient
      // sits on a "not listed" floor below the axis's real range — never at zero.
      dimensions: cols.map((j) => {
        const vals = rows.map((i) => m.values[i]![j]).filter((v): v is number => v != null);
        const lo = Math.min(...vals), hi = Math.max(...vals), floor = lo - (hi - lo || 1) * 0.25;
        const anyMissing = vals.length < rows.length;
        return {
          label: m.ingredients[j]!.label, values: rows.map((i) => m.values[i]![j] ?? floor),
          range: [anyMissing ? floor : lo, hi],
          ...(anyMissing ? { tickvals: [floor, lo, hi], ticktext: ["not listed", String(lo), String(hi)] } : {}),
        };
      }),
      line: {
        color: rows.map((i) => (focus === null ? i : i === focus ? 1 : 0)),
        colorscale: focus === null ? COLORWAY.map((c, k) => [k / (COLORWAY.length - 1), c]) : [[0, "#c9bba3"], [1, PAPRIKA]],
      },
      labelangle: -30, labelside: "bottom",
    }],
    layout: { margin: { l: 70, r: 70, t: 30, b: 120 } },
  }), [m, cols, focus, rows]);

  if (cols.length < 2) return <p className="empty">Too few shared ingredients for parallel axes.</p>;
  return <Plot label="Parallel coordinates, one line per recipe" data={data} layout={layout} />;
}

// ── 5. 3D map: three real ratios, or an exploratory projection ──────────────

export function Map3D({ m, focus, onPick }: ViewProps) {
  const cols = useMemo(() => shared(m, 2), [m]);
  const [axes, setAxes] = useState<[number, number, number] | null>(null);
  const [mode, setMode] = useState<"ratios" | "projection">("ratios");
  const chosen = axes ?? ([cols[0], cols[1], cols[2]] as [number, number, number]);
  const embedding = useMemo(() => (m.fixedBasis.length >= 3 ? classicalMds(m.fixedDistance, 3) : null), [m]);

  const marker = {
    size: m.recipes.map((_, i) => (i === focus ? 11 : 7)),
    color: m.recipes.map((_, i) => (i === focus ? PAPRIKA : "#4a3b33")),
  };
  const scene = (titles: string[]) => ({
    scene: Object.fromEntries(["xaxis", "yaxis", "zaxis"].map((k, a) => [k, { title: { text: titles[a] }, gridcolor: LINE, backgroundcolor: "#fbf6ec", showbackground: true }])),
    margin: { l: 0, r: 0, t: 0, b: 0 },
  });

  let plot;
  if (mode === "ratios") {
    if (cols.length < 3) return <p className="empty">Fewer than three shared ingredients — nothing to put on three axes.</p>;
    // Only recipes that list all three: a missing ratio has no position.
    const rows = m.recipes.map((_, i) => i).filter((i) => chosen.every((j) => m.values[i]![j] != null));
    plot = (
      <Plot label="3D map on three ingredient ratios" height={540}
        data={[{
          type: "scatter3d", mode: "markers+text", text: rows.map((i) => recipeLabel(m, i)), textposition: "top center",
          x: rows.map((i) => m.values[i]![chosen[0]]), y: rows.map((i) => m.values[i]![chosen[1]]), z: rows.map((i) => m.values[i]![chosen[2]]),
          customdata: rows, marker: { size: rows.map((i) => marker.size[i]), color: rows.map((i) => marker.color[i]) },
          hovertemplate: "%{text}<br>%{x} · %{y} · %{z}<extra></extra>",
        }]}
        layout={scene(chosen.map((j) => `${m.ingredients[j]!.label} (${m.unitLabel})`))}
        onPointClick={(p) => onPick({ recipe: p.customdata as number, ingredient: chosen[0] })} />
    );
  } else if (!embedding) {
    plot = <p className="empty">Only {m.fixedBasis.length} ingredient(s) are listed by every recipe. A projection needs at least three, so none is drawn.</p>;
  } else {
    plot = (
      <>
        <p className="muted pane__note">
          Exploratory. Aitchison distance over the {m.fixedBasis.length} ingredients every recipe lists
          ({m.fixedBasis.map((j) => m.ingredients[j]!.label).join(" · ")}), projected by classical MDS;
          three axes keep {Math.round(embedding.explained * 100)}% of it. Positions are approximate — check a pair in the heatmap.
        </p>
        <Plot label="Exploratory 3D projection of recipe similarity" height={540}
          data={[{
            type: "scatter3d", mode: "markers+text", text: m.recipes.map((_, i) => recipeLabel(m, i)), textposition: "top center",
            x: embedding.points.map((p) => p[0]), y: embedding.points.map((p) => p[1]), z: embedding.points.map((p) => p[2]),
            marker, hovertemplate: "%{text}<extra></extra>",
          }]}
          layout={scene(["axis 1", "axis 2", "axis 3"])} />
      </>
    );
  }

  return (
    <>
      <div className="pickers pickers--inline">
        <select className="picker" aria-label="Map type" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="ratios">Three ingredient ratios</option>
          <option value="projection">Projection of all shared ingredients</option>
        </select>
        {mode === "ratios" && cols.length >= 3 && ([0, 1, 2] as const).map((a) => (
          <select key={a} className="picker" aria-label={`Axis ${a + 1}`} value={chosen[a]}
            onChange={(e) => { const next = [...chosen] as [number, number, number]; next[a] = Number(e.target.value); setAxes(next); }}>
            {cols.map((j) => <option key={j} value={j}>{m.ingredients[j]!.label}</option>)}
          </select>
        ))}
      </div>
      {plot}
    </>
  );
}

// ── 7. Ternary ──────────────────────────────────────────────────────────────

export function Ternary({ m, focus }: ViewProps) {
  // Largest classes first, with water-salt-and-spice ("unanchorable") last: it is
  // mostly water, and as a default corner it drags every recipe into one point.
  const usable = useMemo(() => {
    const total = (k: number) => m.classValues.reduce((sum, r) => sum + r[k]!, 0);
    return m.classes.map((_, k) => k)
      .filter((k) => total(k) > 0)
      .sort((a, b) => Number(m.classes[a] === "unanchorable") - Number(m.classes[b] === "unanchorable") || total(b) - total(a));
  }, [m]);
  const [picked, setPicked] = useState<[number, number, number] | null>(null);
  const abc = picked ?? ([usable[0], usable[1], usable[2]] as [number, number, number]);

  if (usable.length < 3) return <p className="empty">A ternary chart needs three food classes; this view has {usable.length}.</p>;

  // Its own composition: the three chosen classes, renormalized to sum to 100.
  // Both numerator and denominator share the anchor, so it cancels — these are
  // shares of mass among the three, not anchor percentages.
  const rows = m.recipes.map((_, i) => i).filter((i) => abc.some((k) => m.classValues[i]![k]! > 0));
  const share = (i: number, k: number) => {
    const total = abc.reduce((s, c) => s + m.classValues[i]![c]!, 0);
    return Math.round((m.classValues[i]![k]! / total) * 1000) / 10;
  };
  const axis = (k: number) => ({ title: { text: m.classes[k] }, gridcolor: LINE });

  return (
    <>
      <div className="pickers pickers--inline">
        {([0, 1, 2] as const).map((a) => (
          <select key={a} className="picker" aria-label={`Corner ${a + 1}`} value={abc[a]}
            onChange={(e) => { const next = [...abc] as [number, number, number]; next[a] = Number(e.target.value); setPicked(next); }}>
            {usable.map((k) => <option key={k} value={k}>{m.classes[k]}</option>)}
          </select>
        ))}
      </div>
      <Plot label="Ternary composition across three food classes" height={520}
        data={[{
          type: "scatterternary", mode: "markers+text", textposition: "top center",
          a: rows.map((i) => share(i, abc[0])), b: rows.map((i) => share(i, abc[1])), c: rows.map((i) => share(i, abc[2])),
          text: rows.map((i) => recipeLabel(m, i)),
          marker: { size: rows.map((i) => (i === focus ? 15 : 10)), color: rows.map((i) => (i === focus ? PAPRIKA : "#4a3b33")) },
          hovertemplate: "%{text}<br>%{a}% · %{b}% · %{c}%<extra></extra>",
        }]}
        layout={{ ternary: { sum: 100, aaxis: axis(abc[0]), baxis: axis(abc[1]), caxis: axis(abc[2]), bgcolor: "#fff" }, margin: { l: 60, r: 60, t: 40, b: 40 } }} />
    </>
  );
}
