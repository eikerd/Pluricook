/**
 * A recipe as a spreadsheet you edit in place.
 *
 * The details — title, author, source, servings and times — are one row; the
 * lines are one row each. Section and Line are typed into; the columns after
 * them are how the parser read the line (quantity, unit, name, stated grams),
 * the grams it came to, its share of the recipe and the USDA food it matched;
 * a line edited and not yet saved shows none until the server has read it. # is the recipe's own order, so sorting
 * by it puts the lines back as the recipe lists them. Every column sorts.
 */

import { useMemo, useState } from "react";
import type { DetailLine, RecipeDetail } from "../lib/recipe-detail";
import { CellInput } from "./CellInput";
import { pairParsed, rowsOf, withRows, type Draft, type SheetRow } from "./recipe-draft";
import { SortableGrid, type GridColumn } from "./SortableGrid";

interface RecipeLinesProps {
  detail: RecipeDetail;
  /** The recipe as edited so far, which may run ahead of `detail` while a save is out. */
  draft: Draft;
  /** True while a save is out: the parsed columns describe the last saved lines. */
  pending: boolean;
  onCommit: (next: Draft) => void;
  /** A line to mark: the one clicked on a chart. */
  highlight: string | null;
  /** Lines of the published recipe; any line not among them is the owner's. */
  published: Set<string> | null;
}

type Row = SheetRow & { n: number; parsed: DetailLine | null };

const figure = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const grams = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const quantityOf = (r: Row) => {
  const q = r.parsed?.read.quantity ?? null;
  return q === null || Number.isNaN(q) ? null : q;
};
const dash = (v: string | null | undefined) => v ?? "—";

const DETAILS: Array<{ key: keyof Draft & string; label: string; numeric?: boolean; placeholder?: string }> = [
  { key: "sourceTitle", label: "Title" },
  { key: "author", label: "Author" },
  { key: "sourceUrl", label: "Source address", placeholder: "https://" },
  { key: "servings", label: "Serves", numeric: true },
  { key: "prepTimeMinutes", label: "Prep min", numeric: true },
  { key: "cookTimeMinutes", label: "Cook min", numeric: true },
  { key: "totalTimeMinutes", label: "Total min", numeric: true },
];

export function RecipeLines({ detail, draft, pending, onCommit, highlight, published }: RecipeLinesProps) {
  const sheet = useMemo(() => rowsOf(draft), [draft]);
  const rows = useMemo(() => {
    const parsed = pairParsed(sheet, detail.sections.flatMap((s) => s.lines));
    return sheet.map((r, i): Row => ({ ...r, n: i + 1, parsed: parsed[i] ?? null }));
  }, [sheet, detail]);

  const setRow = (n: number, patch: Partial<SheetRow>) =>
    onCommit(withRows(draft, sheet.map((r, i) => (i === n - 1 ? { ...r, ...patch } : r))));

  const columns = useMemo((): GridColumn<Row>[] => [
    { key: "n", label: "#", numeric: true, value: (r) => r.n },
    {
      key: "section", label: "Section", value: (r) => r.section,
      render: (r) => <CellInput column="section" label={`Section of line ${r.n}`} value={r.section} placeholder="—"
        onCommit={(section) => setRow(r.n, { section })} />,
    },
    {
      key: "line", label: "Line", value: (r) => r.line,
      render: (r) => (
        <>
          <CellInput column="line" label={`Line ${r.n}`} value={r.line} onCommit={(line) => setRow(r.n, { line })} />
          {published && !published.has(r.line) && <span className="tag">edited</span>}
        </>
      ),
    },
    { key: "qty", label: "Qty", numeric: true, value: quantityOf, render: (r) => { const q = quantityOf(r); return q === null ? "—" : figure.format(q); } },
    { key: "unit", label: "Unit", value: (r) => r.parsed?.read.unit ?? null, render: (r) => dash(r.parsed?.read.unit) },
    { key: "name", label: "Name", value: (r) => r.parsed?.read.name ?? null, render: (r) => dash(r.parsed?.read.name) },
    {
      key: "stated", label: "Stated", numeric: true, value: (r) => r.parsed?.read.statedGrams ?? null,
      render: (r) => (r.parsed?.read.statedGrams == null ? "—" : grams.format(r.parsed.read.statedGrams)),
    },
    {
      key: "grams", label: "Grams", numeric: true, value: (r) => r.parsed?.grams ?? null,
      render: (r) => (r.parsed?.grams == null ? "—" : <strong>{grams.format(r.parsed.grams)}</strong>),
    },
    {
      key: "share", label: "Share", numeric: true, value: (r) => r.parsed?.share ?? null,
      render: (r) => (r.parsed?.share == null ? "—" : `${r.parsed.share.toFixed(1)}%`),
    },
    {
      key: "food", label: "USDA food", value: (r) => r.parsed?.food ?? null,
      render: (r) => r.parsed?.food ?? <span className="muted">not resolved</span>,
    },
    {
      key: "delete", label: "Delete", sortable: false, value: () => null,
      render: (r) => (
        <button type="button" className="cell-delete" aria-label={`Delete line ${r.n}`} title="Delete this line"
          onClick={() => setRow(r.n, { line: "" })}>×</button>
      ),
    },
    // setRow reads the current draft; the columns are rebuilt with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [draft, published]);

  // Keyed by the line count, so adding a line clears the blank row for the next.
  const blank = (
    <BlankRow key={sheet.length} span={columns.length - 3} lastSection={sheet.at(-1)?.section ?? ""}
      onAdd={(row) => onCommit(withRows(draft, [...sheet, row]))} />
  );

  return (
    <div className="recipe__lines" data-pending={pending || undefined}>
      <div className="grid-wrap grid-wrap--fit">
        <table className="grid grid--static" aria-label={`Details of ${detail.siteName}'s recipe`}>
          <thead>
            <tr>{DETAILS.map((d) => <th key={d.key} className={d.numeric ? "num" : undefined}>{d.label}</th>)}</tr>
          </thead>
          <tbody>
            <tr>
              {DETAILS.map((d) => (
                <td key={d.key} className={d.numeric ? "num" : undefined}>
                  <CellInput column={d.key} label={d.label} numeric={d.numeric} placeholder={d.placeholder ?? "—"}
                    value={String(draft[d.key] ?? "")}
                    onCommit={(text) => onCommit({ ...draft, [d.key]: text })} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <SortableGrid
        label={`Lines of ${detail.siteName}'s recipe`}
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.n)}
        initialSort={{ key: "n", dir: "asc" }}
        rowClass={(r) => (r.line === highlight ? "is-highlighted" : undefined)}
        footer={blank}
      />
    </div>
  );
}

/**
 * The blank last row a line is added from. Its section is held until the line
 * is typed — a section with no line is nothing to save — and defaults to the
 * section of the line above.
 */
function BlankRow({ span, lastSection, onAdd }: { span: number; lastSection: string; onAdd: (row: SheetRow) => void }) {
  const [section, setSection] = useState("");
  return (
    <tr className="sheet__add">
      <td className="num muted">+</td>
      <td><CellInput column="section" label="Section of a new line" value={section} placeholder={lastSection || "—"} onCommit={setSection} /></td>
      <td><CellInput column="line" label="A new line" value="" placeholder="Add a line"
        onCommit={(line) => line.trim() && onAdd({ section: section.trim() || lastSection, line })} /></td>
      <td colSpan={span} />
    </tr>
  );
}
