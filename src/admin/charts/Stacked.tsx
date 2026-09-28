/**
 * One bar per recipe, stacked by ingredient: what each recipe is made of.
 *
 * Recipes run down the left and the ingredients across the top, as the owner
 * laid it out on 2026-09-28 — d3's normalized stacked bar, horizontal. Shares
 * of each recipe by default, grams on a switch. The most shared ingredients sit
 * at the left edge, where bars compare directly; everything rarer is one
 * hatched Other band at the right end, which hovering itemizes. The order and
 * the folding are in stack.ts, where they are tested.
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
/** Vertical room per recipe, in px: a bar plus its share of the gap. */
const ROW = 44;

const grams = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const share = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);
const amount = (g: number, total: number) => `${grams.format(g)} g · ${share(g, total).toFixed(1)}%`;

type Scale = "share" | "grams";

export function Stacked({ m, focus, onPick }: ViewProps) {
  const [scale, setScale] = useState<Scale>("share");
  const s = useMemo(() => stackComposition(m), [m]);

  const { data, layout } = useMemo(() => {
    const labels = rowLabels(m);
    const y = s.bars.map((b) => labels[b.recipe]!);
    const length = (g: number, total: number) => (scale === "share" ? share(g, total) : g);

    const traces: Array<Record<string, unknown>> = s.segments.map((seg, k) => ({
      type: "bar",
      orientation: "h",
      name: `${seg.label} · ${seg.recipeCount}/${m.recipes.length}`,
      y,
      x: s.bars.map((b) => length(b.grams[k]!, b.total)),
      customdata: s.bars.map((b) => [b.recipe, seg.ingredient]),
      text: s.bars.map((b) => amount(b.grams[k]!, b.total)),
      textposition: "none",
      hovertemplate: `%{y}<br>${seg.label}: %{text}<extra></extra>`,
      marker: { color: SEGMENT_COLORS[k], line: GAP },
    }));

    if (s.hasOther) {
      traces.push({
        type: "bar",
        orientation: "h",
        name: "Other",
        y,
        x: s.bars.map((b) => length(b.other, b.total)),
        customdata: s.bars.map((b) => [b.recipe, -1]),
        text: s.bars.map((b) => {
          const items = b.otherItems.slice(0, OTHER_LISTED).map((o) => `${o.label} ${grams.format(o.grams)} g`);
          const more = b.otherItems.length - OTHER_LISTED;
          return [amount(b.other, b.total), ...items, ...(more > 0 ? [`and ${more} more`] : [])].join("<br>");
        }),
        textposition: "none",
        hovertemplate: "%{y}<br>Other: %{text}<extra></extra>",
        marker: { ...OTHER_FILL, line: GAP },
      });
    }

    const longest = Math.max(...s.bars.map((b) => b.total), 1);
    return {
      data: traces,
      layout: {
        barmode: "stack",
        bargap: 0.3,
        barcornerradius: 4,
        // Room on the right for each bar's weight, written past its end.
        margin: { l: 20, r: 80, t: 20, b: 50 },
        legend: { orientation: "h", x: 0, xanchor: "left", y: 1, yanchor: "bottom", traceorder: "normal" },
        hoverlabel: { align: "left" },
        yaxis: {
          automargin: true, autorange: "reversed", categoryorder: "array", categoryarray: y, tickvals: y,
          ticktext: s.bars.map((b) => (b.recipe === focus ? `<b>${labels[b.recipe]}</b>` : labels[b.recipe]!)),
        },
        xaxis: scale === "share"
          ? { title: { text: "Share of recipe" }, range: [0, 100], tickvals: [0, 25, 50, 75, 100], ticksuffix: "%", gridcolor: LINE }
          : { title: { text: "Grams" }, range: [0, longest], gridcolor: LINE },
        // Each bar's weight, past its end, in text ink rather than a series colour.
        annotations: s.bars.map((b) => ({
          y: labels[b.recipe], x: scale === "share" ? 100 : b.total, xanchor: "left", xshift: 6,
          text: `${grams.format(b.total)} g`, showarrow: false, font: { size: 11, color: INK },
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
      <Plot label="Stacked bars, one per recipe, by ingredient" data={data} layout={layout}
        height={160 + ROW * s.bars.length} onPointClick={click} />
    </>
  );
}
