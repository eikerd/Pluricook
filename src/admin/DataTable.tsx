/**
 * The table viewer. Read-only: rows are edited in the source files, not here.
 *
 * Every column header sorts, ascending then descending, and the active column
 * says which way it is going. Sorting and paging are server-side so the USDA
 * tables behave the same at 13,000 rows as the registry does at 27.
 */

import { useEffect, useState, type ReactNode } from "react";
import { rowLinkHandlers } from "./row-link";

export interface Column {
  key: string;
  label: string;
  numeric?: boolean;
  badge?: boolean;
  width?: string;
}

interface PageResult {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  columns: Column[];
  label: string;
  /** What the server sorted by — the table's default when no header has been clicked. */
  sort?: string;
  dir?: "asc" | "desc";
  missing?: string;
}

/** Badge colours by value, so a stance or an outcome reads at a glance. */
const BADGE_TONE: Record<string, string> = {
  prohibited: "badge--stop",
  refused: "badge--stop",
  "ai-blocked": "badge--warn",
  blocked: "badge--warn",
  unknown: "badge--mute",
  open: "badge--go",
  ok: "badge--go",
  recipe: "badge--go",
  video: "badge--mute",
  social: "badge--mute",
  raw: "badge--mute",
  managed: "badge--info",
  foundation: "badge--go",
  "sr-legacy": "badge--info",
  "survey-fndds": "badge--warn",
  // Curated tiers and acquisition decisions.
  required: "badge--star",
  favorite: "badge--star",
  fetch: "badge--go",
  licensed: "badge--go",
  "link-only": "badge--warn",
  "pending-review": "badge--warn",
  none: "badge--stop",
};

/** The star cell: click cycles normal → required → favorite → normal. */
const NEXT_TIER: Record<string, string> = {
  normal: "required",
  required: "favorite",
  favorite: "normal",
  blocked: "blocked", // a blocked site is not un-blocked by a stray click
};

const TIER_GLYPH: Record<string, string> = {
  required: "★",
  favorite: "☆",
  normal: "·",
  blocked: "⊘",
};

function StarCell({
  row,
  onChange,
}: {
  row: Record<string, unknown>;
  onChange: (host: string, tier: string, displayName: string) => void;
}) {
  const tier = String(row.tier ?? "normal");
  const host = String(row.host ?? "");
  const blocked = tier === "blocked";

  return (
    <td className="star">
      <button
        className={`star__btn star__btn--${tier}`}
        disabled={blocked}
        title={
          blocked
            ? "Blocked — this site prohibits it in writing. Change it in data/sources/curated.json."
            : `${tier} — click to make it ${NEXT_TIER[tier]}`
        }
        onClick={() => onChange(host, NEXT_TIER[tier]!, String(row.site ?? host))}
      >
        {TIER_GLYPH[tier] ?? "·"}
      </button>
    </td>
  );
}

const isEmpty = (value: unknown) => value === null || value === undefined || value === "";

/**
 * What a cell shows, apart from its <td>. Shared with grids that draw their own
 * cells — a term's recipes — so a value reads the same in every table.
 */
export function cellContent(column: Column, value: unknown): ReactNode {
  if (isEmpty(value)) return "—";
  if (column.badge) {
    return <span className={`badge ${BADGE_TONE[String(value)] ?? "badge--mute"}`}>{String(value)}</span>;
  }
  if (column.key === "url") {
    const href = String(value);
    // In a clickable row, the row leaves the link to open the source alone (row-link.ts).
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {href.replace(/^https?:\/\/(www\.)?/, "")}
      </a>
    );
  }
  if (column.numeric && typeof value === "number") return value.toLocaleString();
  return String(value);
}

function Cell({ column, value }: { column: Column; value: unknown }) {
  const content = cellContent(column, value);
  if (isEmpty(value)) return <td className={column.numeric ? "num muted" : "muted"}>{content}</td>;
  if (column.badge) return <td>{content}</td>;
  if (column.key === "url") return <td className="url">{content}</td>;
  if (column.numeric) return <td className="num">{content}</td>;
  return <td title={String(value)}>{content}</td>;
}

interface DataTableProps {
  datasetId: string;
  searchable: boolean;
  /** Open a row's own page. Rows become clickable, and reachable by keyboard. */
  onRowClick?: (row: Record<string, unknown>) => void;
}

export function DataTable({ datasetId, searchable, onRowClick }: DataTableProps) {
  const [data, setData] = useState<PageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(true);
  // Bumped after a star write so the table re-reads the curated file.
  const [refresh, setRefresh] = useState(0);

  // A new table starts fresh rather than inheriting the last one's sort column.
  useEffect(() => {
    setSort(null);
    setPage(1);
    setQuery("");
  }, [datasetId]);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (sort) params.set("sort", sort);
    if (sort) params.set("dir", dir);
    if (query) params.set("q", query);

    let cancelled = false;
    setPending(true);
    // Debounced so typing in the search box does not fire a query per keystroke.
    const timer = setTimeout(() => {
      fetch(`/api/admin/data/${datasetId}?${params}`)
        .then(async (r) => {
          // A failed request must not leave the previous table on screen looking
          // like this one's data — say what broke instead.
          if (!r.ok) throw new Error(`HTTP ${r.status} loading “${datasetId}”`);
          return r.json();
        })
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setError(null);
          setPending(false);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setData(null);
          setError(e.message);
          setPending(false);
        });
    }, query ? 250 : 0);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [datasetId, sort, dir, page, query, refresh]);

  /**
   * Star a site. The write goes to data/sources/curated.json, so the change is a
   * reviewable diff, not a hidden row in a gitignored database.
   */
  async function setStar(host: string, tier: string, displayName: string) {
    const res = await fetch(`/api/admin/sources/${encodeURIComponent(host)}/tier`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier, displayName }),
    });
    if (!res.ok) {
      setError(`Could not star ${host}: HTTP ${res.status}`);
      return;
    }
    setRefresh((n) => n + 1);
  }

  // The header says what the rows are sorted by: the column clicked, or else
  // the table's own default, as the server reports it.
  const shownSort = sort ?? data?.sort ?? null;
  const shownDir = sort ? dir : (data?.dir ?? "asc");

  function toggleSort(key: string) {
    setSort(key);
    setDir(shownSort === key && shownDir === "asc" ? "desc" : "asc");
    setPage(1);
  }

  if (error) {
    return (
      <div className="pane">
        <header className="pane__head"><div><h2>Something broke</h2></div></header>
        <p className="failure">{error}. Check the dev-server log for the query that failed.</p>
      </div>
    );
  }

  if (!data) return <div className="pane"><p className="muted">Loading…</p></div>;

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const first = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const last = Math.min(data.page * data.pageSize, data.total);

  return (
    <div className="pane">
      <header className="pane__head">
        <div>
          <h2>{data.label}</h2>
        </div>
        {searchable && (
          <input
            className="search"
            type="search"
            placeholder="Filter…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          />
        )}
      </header>

      {data.missing ? (
        <p className="empty">{data.missing}</p>
      ) : data.rows.length === 0 ? (
        <p className="empty">No rows{query ? ` matching “${query}”` : ""}.</p>
      ) : (
        <div className="grid-wrap" data-pending={pending || undefined}>
          <table className="grid">
            <thead>
              <tr>
                {data.columns.map((c) => {
                  const active = shownSort === c.key;
                  return (
                    <th
                      key={c.key}
                      style={c.width ? { minWidth: c.width } : undefined}
                      className={`${c.numeric ? "num" : ""} ${active ? "sorted" : ""}`}
                      onClick={() => toggleSort(c.key)}
                      title={`Sort by ${c.label}`}
                    >
                      {c.label}
                      <span className="arrow">{active ? (shownDir === "asc" ? "▲" : "▼") : "↕"}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr
                  key={i}
                  {...(onRowClick && { className: "is-link", ...rowLinkHandlers(() => onRowClick(row)) })}
                >
                  {data.columns.map((c) =>
                    c.key === "tier" ? (
                      <StarCell key={c.key} row={row} onChange={setStar} />
                    ) : (
                      <Cell key={c.key} column={c} value={row[c.key]} />
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.total > 0 && (
        <footer className="pager">
          <span className="muted">
            {first.toLocaleString()}–{last.toLocaleString()} of {data.total.toLocaleString()}
          </span>
          <div className="pager__buttons">
            <button disabled={data.page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="muted">Page {data.page} of {pages.toLocaleString()}</span>
            <button disabled={data.page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </footer>
      )}
    </div>
  );
}
