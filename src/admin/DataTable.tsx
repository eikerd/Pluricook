/**
 * The table viewer. Read-only: rows are edited in the source files, not here.
 *
 * Every column header sorts, ascending then descending, and the active column
 * says which way it is going. Sorting and paging are server-side so the USDA
 * tables behave the same at 13,000 rows as the registry does at 27.
 */

import { useEffect, useState } from "react";

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
};

function Cell({ column, value }: { column: Column; value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <td className={column.numeric ? "num muted" : "muted"}>—</td>;
  }

  if (column.badge) {
    const tone = BADGE_TONE[String(value)] ?? "badge--mute";
    return (
      <td>
        <span className={`badge ${tone}`}>{String(value)}</span>
      </td>
    );
  }

  if (column.key === "url") {
    const href = String(value);
    return (
      <td className="url">
        <a href={href} target="_blank" rel="noreferrer noopener">
          {href.replace(/^https?:\/\/(www\.)?/, "")}
        </a>
      </td>
    );
  }

  if (column.numeric) {
    return <td className="num">{typeof value === "number" ? value.toLocaleString() : String(value)}</td>;
  }

  return <td title={String(value)}>{String(value)}</td>;
}

export function DataTable({ datasetId, searchable }: { datasetId: string; searchable: boolean }) {
  const [data, setData] = useState<PageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(true);

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
  }, [datasetId, sort, dir, page, query]);

  function toggleSort(key: string) {
    if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(key); setDir("asc"); }
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
                  const active = sort === c.key;
                  return (
                    <th
                      key={c.key}
                      style={c.width ? { minWidth: c.width } : undefined}
                      className={`${c.numeric ? "num" : ""} ${active ? "sorted" : ""}`}
                      onClick={() => toggleSort(c.key)}
                      title={`Sort by ${c.label}`}
                    >
                      {c.label}
                      <span className="arrow">{active ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i}>
                  {data.columns.map((c) => (
                    <Cell key={c.key} column={c} value={row[c.key]} />
                  ))}
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
