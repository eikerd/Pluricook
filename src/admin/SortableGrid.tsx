/**
 * A sortable grid for data that arrives whole.
 *
 * DataTable sorts on the server because its tables run to thousands of rows. A
 * comparison is a few dozen, already in the browser, so sorting it is a local
 * matter. The markup and class names match DataTable's, so the two read as one
 * component.
 */

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { rowLinkHandlers } from "./row-link";

export type SortValue = string | number | null;
export type SortDir = "asc" | "desc";

export interface GridColumn<T> {
  key: string;
  label: string;
  numeric?: boolean;
  /** What the column sorts by. */
  value: (row: T) => SortValue;
  /** What the cell shows, when that differs from the sort value. */
  render?: (row: T) => ReactNode;
  /** False for a column of controls, which has nothing to sort by. */
  sortable?: boolean;
}

interface SortableGridProps<T> {
  columns: GridColumn<T>[];
  rows: T[];
  /** What the table is, for a screen reader — several grids share one page, some nested. */
  label: string;
  /**
   * A stable, unique key. `index` is the row's place in `rows` as given, which
   * does not move when the grid is sorted — use it when the data alone cannot
   * tell two rows apart (one recipe listing "salt, to taste" twice).
   */
  rowKey: (row: T, index: number) => string;
  initialSort: { key: string; dir: SortDir };
  /**
   * What a row opens to show. When given, the first cell carries a toggle.
   * Open rows are remembered by key, so they stay open through a re-sort.
   */
  detail?: (row: T) => ReactNode;
  /** A class for a row, to mark one — the line clicked on a chart. */
  rowClass?: (row: T) => string | undefined;
  /** Open a row's own page, as DataTable does: rows become clickable, and reachable by keyboard. */
  onRowClick?: (row: T) => void;
  /** A last row that no sort moves — the blank row a sheet adds lines from. */
  footer?: ReactNode;
}

/** Nulls sink to the bottom in both directions: "no value" is never the top answer. */
function compare(a: SortValue, b: SortValue, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const order =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
  return dir === "asc" ? order : -order;
}

export function SortableGrid<T>({ columns, rows, label, rowKey, initialSort, detail, rowClass, onRowClick, footer }: SortableGridProps<T>) {
  const [sort, setSort] = useState(initialSort);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const toggleOpen = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const sorted = useMemo(() => {
    // Keys are taken before sorting, while a row's index still means something.
    const keyed = rows.map((row, index) => ({ row, key: rowKey(row, index) }));
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return keyed;
    return keyed.sort((a, b) => compare(column.value(a.row), column.value(b.row), sort.dir));
  }, [columns, rows, rowKey, sort]);

  const toggle = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  return (
    <div className="grid-wrap grid-wrap--fit">
      <table className="grid" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort.key === c.key;
              if (c.sortable === false) return <th key={c.key} className="unsorted" aria-label={c.label || undefined} />;
              return (
                <th
                  key={c.key}
                  className={`${c.numeric ? "num" : ""} ${active ? "sorted" : ""}`}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  onClick={() => toggle(c.key)}
                  title={`Sort by ${c.label}`}
                >
                  {/* A button gives focus, Enter and Space for nothing, and tells a
                      screen reader the header does something. Its click bubbles to
                      the th, so the whole header cell stays the target. */}
                  <button type="button" className="grid__sort">
                    {c.label}
                    <span className="arrow" aria-hidden="true">{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ row, key }) => {
            const isOpen = open.has(key);
            return (
              <Fragment key={key}>
                <tr
                  className={[isOpen ? "is-open" : "", onRowClick ? "is-link" : "", rowClass?.(row) ?? ""].join(" ").trim() || undefined}
                  {...(onRowClick && rowLinkHandlers(() => onRowClick(row)))}
                >
                  {columns.map((c, i) => {
                    const content = c.render ? c.render(row) : (c.value(row) ?? "—");
                    return (
                      <td key={c.key} className={c.numeric ? "num" : ""}>
                        {detail && i === 0 ? (
                          <button
                            type="button"
                            className="grid__toggle"
                            aria-expanded={isOpen}
                            onClick={() => toggleOpen(key)}
                          >
                            <span className="grid__chevron" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                            {content}
                          </button>
                        ) : content}
                      </td>
                    );
                  })}
                </tr>
                {detail && isOpen && (
                  <tr className="grid__detail">
                    <td colSpan={columns.length}>{detail(row)}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {footer}
        </tbody>
      </table>
    </div>
  );
}
