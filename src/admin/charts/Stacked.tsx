/**
 * One column per recipe, stacked by ingredient: what each recipe is made of.
 *
 * Shares of each recipe by default, grams on a switch. The most shared
 * ingredients sit on the baseline, where columns compare directly; everything
 * rarer is one hatched Other band on top, which hovering itemizes. The order
 * and the folding are in stack.ts, where they are tested.
 */

import { useMemo, useState } from "react";
import { INK, LINE, Plot, type PlotClick } from "./Plot";
import { stackComposition } from "./stack";
import { rowLabels, type ViewProps } from "./views";

/**
 * Seven categorical slots in a fixed order, validated for this chart against a
 * white plot: lightness band, chroma floor, contrast of at least 3:1, and
 * colour-blind separation of neighbours. The closest neighbours (7.9 under
 * protanopia) are also split by the 2 px gap. The eighth slot is Other.
 */
const SEGMENT_COLORS = ["#c0441f", "#2a78d6", "#c98500", "#179b6c", "#4a3aa7", "#c8508c", "#3f7f1e"];
const OTHER_FILL = { color: "#e6dfd3", pattern: { shape: "/", fgcolor: "#9c9184", size: 7, solidity: 0.25 } };
const GAP = { color: "#fff", width: 2 };
/** Items listed in the Other tooltip before it says how many more there are. */
const OTHER_LISTED = 8;

const grams = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const share = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);
const amount = (g: number, total: number) => `${grams.format(g)} g · ${share(g, total).toFixed(1)}%`;

type Scale = "share" | "grams";

export function Stacked({ m, focus, onPick }: ViewProps) {
  const [scale, setScale] = useState<Scale>("share");
  const s = useMemo(() => stackComposition(m), [m]);

  const { data, layout } = useMemo(() => {
    const labels = rowLabels(m);
    const x = s.columns.map((c) => labels[c.recipe]!);
    const height = (g: number, total: number) => (scale === "share" ? share(g, total) : g);

    const traces: Array<Record<string, unknown>> = s.segments.map((seg, k) => ({
      type: "bar",
      name: `${seg.label} · ${seg.recipeCount}/${m.recipes.length}`,
      x,
      y: s.columns.map((c) => height(c.grams[k]!, c.total)),
      customdata: s.columns.map((c) => [c.recipe, seg.ingredient]),
      text: s.columns.map((c) => amount(c.grams[k]!, c.total)),
      textposition: "none",
      hovertemplate: `%{x}<br>${seg.label}: %{text}<extra></extra>`,
      marker: { color: SEGMENT_COLORS[k], line: GAP },
    }));

    if (s.hasOther) {
      traces.push({
        type: "bar",
        name: "Other",
        x,
        y: s.columns.map((c) => height(c.other, c.total)),
        customdata: s.columns.map((c) => [c.recipe, -1]),
        text: s.columns.map((c) => {
          const items = c.otherItems.slice(0, OTHER_LISTED).map((o) => `${o.label} ${grams.format(o.grams)} g`);
          const more = c.otherItems.length - OTHER_LISTED;
          return [amount(c.other, c.total), ...items, ...(more > 0 ? [`and ${more} more`] : [])].join("<br>");
        }),
        textposition: "none",
        hovertemplate: "%{x}<br>Other: %{text}<extra></extra>",
        marker: { ...OTHER_FILL, line: GAP },
      });
    }

    const tallest = Math.max(...s.columns.map((c) => c.total), 1);
    return {
      data: traces,
      layout: {
        barmode: "stack",
        bargap: 0.3,
        barcornerradius: 4,
        margin: { l: 70, r: 20, t: 20, b: 150 },
        legend: { orientation: "h", x: 0, xanchor: "left", y: 1.02, yanchor: "bottom", traceorder: "normal" },
        hoverlabel: { align: "left" },
        xaxis: {
          tickangle: -40, categoryorder: "array", categoryarray: x, tickvals: x,
          ticktext: s.columns.map((c) => (c.recipe === focus ? `<b>${labels[c.recipe]}</b>` : labels[c.recipe]!)),
        },
        yaxis: scale === "share"
          ? { title: { text: "Share of recipe" }, range: [0, 108], tickvals: [0, 25, 50, 75, 100], ticksuffix: "%", gridcolor: LINE }
          : { title: { text: "Grams" }, range: [0, tallest * 1.08], gridcolor: LINE },
        // Each column's weight, above it, in text ink rather than a series colour.
        annotations: s.columns.map((c) => ({
          x: labels[c.recipe], y: scale === "share" ? 100 : c.total, yanchor: "bottom", yshift: 2,
          text: `${grams.format(c.total)} g`, showarrow: false, font: { size: 11, color: INK },
        })),
      },
    };
  }, [m, s, scale, focus]);

  const click = (p: PlotClick) => {
    const c = p.customdata as [number, number] | undefined;
    // The Other band holds several ingredients, so it has no single line to show.
    if (c && c[1] >= 0) onPick({ recipe: c[0], ingredient: c[1] });
  };

  if (s.segments.length === 0) return <p className="empty">No recipe here lists an ingredient in grams.</p>;
  return (
    <>
      <div className="pickers pickers--inline">
        <select className="picker" aria-label="Scale" value={scale} onChange={(e) => setScale(e.target.value as Scale)}>
          <option value="share">100%</option>
          <option value="grams">Grams</option>
        </select>
      </div>
      <Plot label="Stacked columns, one per recipe, by ingredient" data={data} layout={layout} height={540} onPointClick={click} />
    </>
  );
}
