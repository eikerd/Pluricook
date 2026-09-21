/**
 * Source registry: accumulates what we learn about recipe websites across every
 * search we run.
 *
 * Three logs feed it, and none of them overwrite each other:
 *   search_appearances — a host showed up at rank N for a dish
 *   fetch_attempts     — we tried to fetch a page and this is what happened
 *   site_policies      — what robots.txt and the site's terms say
 *
 * Statistics are derived on read (see siteStats), never stored, so a re-import
 * or a corrected row changes the report without a migration.
 */

import { Database } from "bun:sqlite";
import type {
  FetchAttempt,
  PolicyStance,
  ResultKind,
  SearchAppearance,
  SiteStats,
  SitePolicy,
} from "../types/source";

/** Default on-disk location. Tests pass ":memory:". */
export const DEFAULT_REGISTRY_PATH = "sources.db";

/**
 * Canonical host for a URL: lowercase, no leading "www.".
 *
 * Identity has to be stable because the same site appears as both forms across
 * search results (budgetbytes.com vs www.budgetbytes.com), and a split identity
 * would give us two half-populated records per site.
 */
export function canonicalHost(url: string): string {
  const raw = url.includes("://") ? new URL(url).hostname : url;
  return raw.toLowerCase().replace(/^www\./, "");
}

/** Readable site name from a host, used until a better one is supplied. */
function defaultDisplayName(host: string): string {
  return host.replace(/\.(com|net|org|co|recipes|kitchen)(\.[a-z]{2})?$/, "");
}

const SCHEMA = /* sql */ `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS sites (
    host           TEXT PRIMARY KEY,
    display_name   TEXT NOT NULL,
    trusted        INTEGER NOT NULL DEFAULT 0,
    first_seen_at  TEXT NOT NULL,
    last_seen_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS site_policies (
    host                  TEXT PRIMARY KEY REFERENCES sites(host) ON DELETE CASCADE,
    robots_generic_allows INTEGER,
    ai_crawlers_blocked   TEXT NOT NULL DEFAULT '[]',  -- JSON array of user-agents
    ad_network_injected   INTEGER NOT NULL DEFAULT 0,
    written_prohibition   INTEGER NOT NULL DEFAULT 0,
    licensing_contact     TEXT,
    note                  TEXT,
    checked_at            TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS search_appearances (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    host    TEXT NOT NULL REFERENCES sites(host) ON DELETE CASCADE,
    url     TEXT NOT NULL,
    query   TEXT NOT NULL,
    rank    INTEGER NOT NULL,
    kind    TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    UNIQUE (query, url, seen_at)
  );

  CREATE TABLE IF NOT EXISTS fetch_attempts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    host             TEXT NOT NULL REFERENCES sites(host) ON DELETE CASCADE,
    url              TEXT NOT NULL,
    fetcher          TEXT NOT NULL,
    status           INTEGER NOT NULL,
    outcome          TEXT NOT NULL,
    cdn              TEXT,
    body_bytes       INTEGER,
    elapsed_ms       INTEGER,
    json_ld          INTEGER NOT NULL DEFAULT 0,
    ingredient_count INTEGER,
    step_count       INTEGER,
    yield_raw        TEXT,
    total_time_raw   TEXT,
    note             TEXT,
    attempted_at     TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_appearances_host ON search_appearances(host);
  CREATE INDEX IF NOT EXISTS idx_appearances_query ON search_appearances(query);
  CREATE INDEX IF NOT EXISTS idx_attempts_host ON fetch_attempts(host);
`;

export function openRegistry(path: string = DEFAULT_REGISTRY_PATH): Database {
  const db = new Database(path, { create: true });
  db.run(SCHEMA);
  return db;
}

/**
 * Ensure a site row exists and widen its seen-at window.
 *
 * Every write path calls this first, so a host is registered by whichever
 * evidence arrives first — a search hit, a fetch, or a policy check.
 */
export function touchSite(
  db: Database,
  host: string,
  at: string,
  displayName?: string,
): void {
  db.query(
    `INSERT INTO sites (host, display_name, first_seen_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?3)
     ON CONFLICT(host) DO UPDATE SET
       last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
       first_seen_at = MIN(first_seen_at, excluded.first_seen_at),
       display_name = CASE
         WHEN ?4 = 1 THEN excluded.display_name ELSE display_name END`,
  ).run(host, displayName ?? defaultDisplayName(host), at, displayName ? 1 : 0);
}

export function setTrusted(db: Database, host: string, trusted: boolean): void {
  db.query(`UPDATE sites SET trusted = ? WHERE host = ?`).run(
    trusted ? 1 : 0,
    canonicalHost(host),
  );
}

export function recordSearchAppearance(
  db: Database,
  a: Omit<SearchAppearance, "host"> & { host?: string },
): void {
  const host = a.host ?? canonicalHost(a.url);
  touchSite(db, host, a.seenAt);
  db.query(
    `INSERT OR IGNORE INTO search_appearances (host, url, query, rank, kind, seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(host, a.url, a.query, a.rank, a.kind, a.seenAt);
}

export function recordFetchAttempt(
  db: Database,
  f: Omit<FetchAttempt, "host"> & { host?: string },
): void {
  const host = f.host ?? canonicalHost(f.url);
  touchSite(db, host, f.attemptedAt);
  db.query(
    `INSERT INTO fetch_attempts (
       host, url, fetcher, status, outcome, cdn, body_bytes, elapsed_ms,
       json_ld, ingredient_count, step_count, yield_raw, total_time_raw,
       note, attempted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    host, f.url, f.fetcher, f.status, f.outcome, f.cdn, f.bodyBytes,
    f.elapsedMs, f.jsonLd ? 1 : 0, f.ingredientCount, f.stepCount,
    f.yieldRaw, f.totalTimeRaw, f.note, f.attemptedAt,
  );
}

export function upsertPolicy(db: Database, p: SitePolicy): void {
  const host = canonicalHost(p.host);
  touchSite(db, host, p.checkedAt);
  db.query(
    `INSERT INTO site_policies (
       host, robots_generic_allows, ai_crawlers_blocked, ad_network_injected,
       written_prohibition, licensing_contact, note, checked_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(host) DO UPDATE SET
       robots_generic_allows = excluded.robots_generic_allows,
       ai_crawlers_blocked   = excluded.ai_crawlers_blocked,
       ad_network_injected   = excluded.ad_network_injected,
       written_prohibition   = excluded.written_prohibition,
       licensing_contact     = excluded.licensing_contact,
       note                  = excluded.note,
       checked_at            = excluded.checked_at`,
  ).run(
    host,
    p.robotsGenericAllows === null ? null : p.robotsGenericAllows ? 1 : 0,
    JSON.stringify(p.aiCrawlersBlocked),
    p.adNetworkInjected ? 1 : 0,
    p.writtenProhibition ? 1 : 0,
    p.licensingContact,
    p.note,
    p.checkedAt,
  );
}

/**
 * Derive a stance from the policy evidence.
 *
 * Order matters: a written prohibition outranks robots.txt, because robots.txt
 * being permissive is not permission when the terms say otherwise. That is the
 * People Inc case — generic crawling allowed, data mining prohibited in words.
 */
export function deriveStance(p: {
  robotsGenericAllows: boolean | null;
  aiCrawlersBlocked: string[];
  writtenProhibition: boolean;
} | null): PolicyStance {
  if (!p) return "unknown";
  if (p.writtenProhibition) return "prohibited";
  if (p.aiCrawlersBlocked.length > 0) return "ai-blocked";
  if (p.robotsGenericAllows === true) return "open";
  return "unknown";
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 10) / 10;
}

type SiteRow = {
  host: string;
  display_name: string;
  trusted: number;
  last_seen_at: string;
  robots_generic_allows: number | null;
  ai_crawlers_blocked: string | null;
  written_prohibition: number | null;
  licensing_contact: string | null;
};

/**
 * One row per host, every accumulated number on it.
 *
 * Sorted by appearances then best rank by default: the sites we keep meeting
 * are the ones whose policy matters most.
 */
export function siteStats(db: Database): SiteStats[] {
  const sites = db.query<SiteRow, []>(
    `SELECT s.host, s.display_name, s.trusted, s.last_seen_at,
            p.robots_generic_allows, p.ai_crawlers_blocked,
            p.written_prohibition, p.licensing_contact
     FROM sites s LEFT JOIN site_policies p ON p.host = s.host`,
  ).all();

  const ranks = db.query<{ host: string; rank: number }, []>(
    `SELECT host, rank FROM search_appearances ORDER BY rank`,
  ).all();

  const queries = db.query<{ host: string; n: number }, []>(
    `SELECT host, COUNT(DISTINCT query) AS n FROM search_appearances GROUP BY host`,
  ).all();

  const outcomes = db.query<
    { host: string; outcome: string; fetcher: string; n: number; ld: number },
    []
  >(
    `SELECT host, outcome, fetcher, COUNT(*) AS n, SUM(json_ld) AS ld
     FROM fetch_attempts GROUP BY host, outcome, fetcher`,
  ).all();

  // A "rescue" is a host that a raw fetcher failed on and a managed one cleared.
  const rescues = db.query<{ host: string; n: number }, []>(
    `SELECT host, COUNT(*) AS n FROM fetch_attempts a
     WHERE a.fetcher = 'managed' AND a.outcome = 'ok'
       AND EXISTS (SELECT 1 FROM fetch_attempts b
                   WHERE b.host = a.host AND b.fetcher = 'raw'
                     AND b.outcome IN ('blocked', 'refused'))
     GROUP BY host`,
  ).all();

  const byHost = <T extends { host: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(r.host) ?? m.set(r.host, []).get(r.host)!).push(r);
    return m;
  };

  const rankMap = byHost(ranks);
  const outcomeMap = byHost(outcomes);
  const queryMap = new Map(queries.map((q) => [q.host, q.n]));
  const rescueMap = new Map(rescues.map((r) => [r.host, r.n]));

  const stats = sites.map((s): SiteStats => {
    const hostRanks = (rankMap.get(s.host) ?? []).map((r) => r.rank);
    const rows = outcomeMap.get(s.host) ?? [];
    const count = (o: string) =>
      rows.filter((r) => r.outcome === o).reduce((n, r) => n + r.n, 0);

    const ok = count("ok");
    const fetches = rows.reduce((n, r) => n + r.n, 0);
    const ldHits = rows
      .filter((r) => r.outcome === "ok")
      .reduce((n, r) => n + (r.ld ?? 0), 0);

    const aiBlocked: string[] = JSON.parse(s.ai_crawlers_blocked ?? "[]");

    return {
      host: s.host,
      displayName: s.display_name,
      trusted: s.trusted === 1,
      stance: deriveStance(
        s.robots_generic_allows === null && !s.ai_crawlers_blocked
          ? null
          : {
              robotsGenericAllows:
                s.robots_generic_allows === null ? null : s.robots_generic_allows === 1,
              aiCrawlersBlocked: aiBlocked,
              writtenProhibition: s.written_prohibition === 1,
            },
      ),
      queries: queryMap.get(s.host) ?? 0,
      appearances: hostRanks.length,
      bestRank: hostRanks.length ? Math.min(...hostRanks) : null,
      medianRank: median([...hostRanks].sort((a, b) => a - b)),
      fetches,
      ok,
      blocked: count("blocked"),
      refused: count("refused"),
      errors: count("error"),
      reachRate: fetches ? Math.round((ok / fetches) * 100) / 100 : null,
      jsonLdRate: ok ? Math.round((ldHits / ok) * 100) / 100 : null,
      managedRescues: rescueMap.get(s.host) ?? 0,
      aiCrawlersBlocked: aiBlocked.length,
      licensingContact: s.licensing_contact,
      lastSeenAt: s.last_seen_at,
    };
  });

  return stats.sort(
    (a, b) =>
      b.appearances - a.appearances ||
      (a.bestRank ?? 999) - (b.bestRank ?? 999) ||
      a.host.localeCompare(b.host),
  );
}
