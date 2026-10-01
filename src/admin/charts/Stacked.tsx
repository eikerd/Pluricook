/**
 * One bar per recipe, stacked by ingredient: what each recipe is made of.
 *
 * Recipes run down the left and the ingredients across the top, as the owner
 * laid it out on 2026-09-28 — d3's normalized stacked bar, horizontal. By
 * default every recipe is scaled to 450 g — a pound — of its primary
 * ingredient, which then drops out of the bars (the owner, 2026-09-30: "the
 * whole point of this application is to not present the recipes as they are,
 * but to filter them through normalization"). Shares of each recipe, or the
 * grams as published, on a switch. The heaviest ingredients sit
 * at the left edge, where bars compare directly; everything lighter is one
 * hatched Other band at the right end, which hovering itemizes. The order and
 * the folding are in stack.ts, where they are tested.
 */

import { useEffect, useMemo, useState } from "react";
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

/** The fixed weight of primary ingredient every recipe is scaled to: a pound. */
export const PER_ANCHOR_GRAMS = 450;

type Scale = "anchor" | "share" | "grams";

export function Stacked({ m, focus, onRecipe }: ViewProps) {
  const anchorClass = m.normalization.kind === "class" ? m.normalization.anchorClass : null;
  const [scale, setScale] = useState<Scale>(anchorClass ? "anchor" : "share");
  // Set by clicking an ingredient in the legend; again reverses it, as a column header does.
  const [sortBy, setSortBy] = useState<{ ingredient: number; dir: "asc" | "desc" } | null>(null);
  // Ingredient indices belong to one matrix: another dish or section starts unsorted.
  useEffect(() => setSortBy(null), [m]);
  // A dish with no primary ingredient has nothing to scale to.
  const active: Scale = scale === "anchor" && !anchorClass ? "share" : scale;
  const perAnchor = `per ${PER_ANCHOR_GRAMS} g of ${anchorClass ?? "the primary ingredient"}`;
  const s = useMemo(
    () => stackComposition(m, { ...(active === "anchor" ? { perAnchor: PER_ANCHOR_GRAMS } : {}), ...(sortBy ? { sortBy } : {}) }),
    [m, active, sortBy],
  );
  // rowLabels are unique, so a recipe's name is enough to find it again.
  const byLabel = useMemo(() => new Map(rowLabels(m).map((label, i) => [label, i])), [m]);

  const arrow = (ingredient: number) => (sortBy?.ingredient === ingredient ? (sortBy.dir === "desc" ? " ▼" : " ▲") : "");

  const { data, layout } = useMemo(() => {
    const labels = rowLabels(m);
    const y = s.bars.map((b) => labels[b.recipe]!);
    const length = (g: number, total: number) => (active === "share" ? share(g, total) : g);
    const describe = (g: number, total: number) => (active === "anchor" ? `${grams.format(g)} g ${perAnchor}` : amount(g, total));

    const traces: Array<Record<string, unknown>> = s.segments.map((seg, k) => ({
      type: "bar",
      orientation: "h",
      // The ingredient alone: the owner, 2026-09-30, "we don't need the numbers".
      // The one the bars are sorted by carries the direction, as a sorted column does.
      name: `${seg.label}${arrow(seg.ingredient)}`,
      y,
      x: s.bars.map((b) => length(b.grams[k]!, b.total)),
      customdata: s.bars.map((b) => [b.recipe, seg.ingredient]),
      text: s.bars.map((b) => describe(b.grams[k]!, b.total)),
      textposition: "none",
      hovertemplate: `%{y}<br>${seg.label}: %{text}<extra></extra>`,
      marker: { color: SEGMENT_COLORS[seg.color], line: GAP },
    }));

    if (s.hasOther) {
      traces.push({
        type: "bar",
        orientation: "h",
        name: `Other${arrow(-1)}`,
        y,
        x: s.bars.map((b) => length(b.other, b.total)),
        customdata: s.bars.map((b) => [b.recipe, -1]),
        text: s.bars.map((b) => {
          const items = b.otherItems.slice(0, OTHER_LISTED).map((o) => `${o.label} ${grams.format(o.grams)} g`);
          const more = b.otherItems.length - OTHER_LISTED;
          return [describe(b.other, b.total), ...items, ...(more > 0 ? [`and ${more} more`] : [])].join("<br>");
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
        // Room at the top for Plotly's toolbar above the legend, whose entries are clicked to sort.
        margin: { l: 20, r: 80, t: 48, b: 50 },
        legend: { orientation: "h", x: 0, xanchor: "left", y: 1, yanchor: "bottom", traceorder: "normal" },
        hoverlabel: { align: "left" },
        yaxis: {
          automargin: true, autorange: "reversed", categoryorder: "array", categoryarray: y, tickvals: y,
          ticktext: s.bars.map((b) => (b.recipe === focus ? `<b>${labels[b.recipe]}</b>` : labels[b.recipe]!)),
        },
        xaxis: active === "share"
          ? { title: { text: "Share of recipe" }, range: [0, 100], tickvals: [0, 25, 50, 75, 100], ticksuffix: "%", gridcolor: LINE }
          : { title: { text: active === "anchor" ? `Grams ${perAnchor}` : "Grams" }, range: [0, longest], gridcolor: LINE },
        // Each bar's weight, past its end, in text ink rather than a series colour.
        annotations: s.bars.map((b) => ({
          y: labels[b.recipe], x: active === "share" ? 100 : b.total, xanchor: "left", xshift: 6,
          text: `${grams.format(b.total)} g`, showarrow: false, font: { size: 11, color: INK },
        })),
      },
    };
  }, [m, s, active, perAnchor, focus, sortBy]);

  // A click anywhere on a bar opens that recipe, with the clicked ingredient
  // marked. The Other band holds several ingredients, so it marks none.
  const click = (p: PlotClick) => {
    const c = p.customdata as [number, number] | undefined;
    if (c) onRecipe?.(c[0], c[1] >= 0 ? c[1] : null);
  };
  // A click on an ingredient in the legend sorts the bars by it.
  const sortByLegend = (curve: number) => {
    const ingredient = s.segments[curve]?.ingredient ?? -1;   // past the segments is Other
    setSortBy((cur) => ({ ingredient, dir: cur?.ingredient === ingredient && cur.dir === "desc" ? "asc" : "desc" }));
  };
  const clickName = (label: string) => {
    const recipe = byLabel.get(label);
    if (recipe !== undefined) onRecipe?.(recipe, null);
  };

  if (s.segments.length === 0) return <p className="empty">No recipe here lists an ingredient in grams.</p>;
  return (
    <>
      <div className="pickers pickers--inline">
        <select className="picker" aria-label="Scale" value={active} onChange={(e) => setScale(e.target.value as Scale)}>
          {anchorClass && <option value="anchor">Per {PER_ANCHOR_GRAMS} g of {anchorClass}</option>}
          <option value="share">100%</option>
          <option value="grams">Grams</option>
        </select>
      </div>
      <Plot label="Stacked bars, one per recipe, by ingredient" data={data} layout={layout}
        height={160 + ROW * s.bars.length} onPointClick={click} onTickClick={clickName} onLegendClick={sortByLegend} />
      {s.unscaled.length > 0 && (
        <p className="muted">
          Not drawn, no {anchorClass} weighed to scale by: {s.unscaled.map((i) => rowLabels(m)[i]).join(", ")}
        </p>
      )}
    </>
  );
}
