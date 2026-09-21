/**
 * A sortable grid for data that arrives whole.
 *
 * DataTable sorts on the server because its tables run to thousands of rows. A
 * comparison is a few dozen, already in the browser, so sorting it is a local
 * matter. The markup and class names match DataTable's, so the two read as one
 * component.
 */

import { useMemo, useState, type ReactNode } from "react";

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
}

interface SortableGridProps<T> {
  columns: GridColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  initialSort: { key: string; dir: SortDir };
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

export function SortableGrid<T>({ columns, rows, rowKey, initialSort }: SortableGridProps<T>) {
  const [sort, setSort] = useState(initialSort);

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return rows;
    return [...rows].sort((a, b) => compare(column.value(a), column.value(b), sort.dir));
  }, [columns, rows, sort]);

  const toggle = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  return (
    <div className="grid-wrap grid-wrap--fit">
      <table className="grid">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort.key === c.key;
              return (
                <th
                  key={c.key}
                  className={`${c.numeric ? "num" : ""} ${active ? "sorted" : ""}`}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  tabIndex={0}
                  onClick={() => toggle(c.key)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    toggle(c.key);
                  }}
                  title={`Sort by ${c.label}`}
                >
                  {c.label}
                  <span className="arrow">{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? "num" : ""}>
                  {c.render ? c.render(row) : (c.value(row) ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
