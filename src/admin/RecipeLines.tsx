/**
 * A recipe's lines as a spreadsheet: one column per field, every column
 * sortable. Each line as written, how the parser read it (quantity, unit,
 * name, stated grams), the grams it came to, its share of the recipe and the
 * USDA food it matched. # is the recipe's own order, so sorting by it puts the
 * lines back as the recipe lists them.
 */

import { useMemo } from "react";
import type { DetailLine, RecipeDetail } from "../lib/recipe-detail";
import { SortableGrid, type GridColumn } from "./SortableGrid";

interface RecipeLinesProps {
  detail: RecipeDetail;
  /** A line to mark: the one clicked on a chart. */
  highlight: string | null;
  /** Lines of the published recipe; any line not among them is the owner's. */
  published: Set<string> | null;
}

type Row = DetailLine & { n: number; section: string | null };

const figure = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const grams = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const sectionName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const quantityOf = (r: Row) => (r.read.quantity === null || Number.isNaN(r.read.quantity) ? null : r.read.quantity);

export function RecipeLines({ detail, highlight, published }: RecipeLinesProps) {
  const rows = useMemo(() => {
    let n = 0;
    return detail.sections.flatMap((s) => s.lines.map((l): Row => ({ ...l, n: ++n, section: s.name })));
  }, [detail]);

  const columns = useMemo(() => {
    const named = detail.sections.some((s) => s.name !== null);
    const all: Array<GridColumn<Row> | false> = [
      { key: "n", label: "#", numeric: true, value: (r) => r.n },
      named && { key: "section", label: "Section", value: (r) => r.section, render: (r) => (r.section ? sectionName(r.section) : "—") },
      {
        key: "line", label: "Line", value: (r) => r.line,
        render: (r) => (
          <>
            {r.line}
            {published && !published.has(r.line) && <span className="tag">edited</span>}
          </>
        ),
      },
      { key: "qty", label: "Qty", numeric: true, value: quantityOf, render: (r) => { const q = quantityOf(r); return q === null ? "—" : figure.format(q); } },
      { key: "unit", label: "Unit", value: (r) => r.read.unit },
      { key: "name", label: "Name", value: (r) => r.read.name },
      { key: "stated", label: "Stated", numeric: true, value: (r) => r.read.statedGrams, render: (r) => (r.read.statedGrams === null ? "—" : grams.format(r.read.statedGrams)) },
      { key: "grams", label: "Grams", numeric: true, value: (r) => r.grams, render: (r) => (r.grams === null ? "—" : <strong>{grams.format(r.grams)}</strong>) },
      { key: "share", label: "Share", numeric: true, value: (r) => r.share, render: (r) => (r.share === null ? "—" : `${r.share.toFixed(1)}%`) },
      {
        key: "food", label: "USDA food", value: (r) => r.food,
        render: (r) =>
          r.food === null ? <span className="muted">not resolved</span> : (
            <>
              {r.food}
              {r.workaround && <span className="tag">{r.workaround}</span>}
            </>
          ),
      },
    ];
    return all.filter((c): c is GridColumn<Row> => c !== false);
  }, [detail, published]);

  return (
    <div className="recipe__lines">
      <SortableGrid
        label={`Lines of ${detail.siteName}'s recipe`}
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.n)}
        initialSort={{ key: "n", dir: "asc" }}
        rowClass={(r) => (r.line === highlight ? "is-highlighted" : undefined)}
      />
    </div>
  );
}
