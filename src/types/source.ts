/**
 * Types for the source registry: what we learn about recipe websites as we
 * search for more dishes.
 *
 * The registry is keyed by canonical host, so every meatloaf search, every
 * carbonara search and every direct site query adds to the same per-site record.
 * Nothing here describes a recipe — see types/recipe.ts for that.
 */

/** What a site has told us, in robots.txt or in its terms. */
export type PolicyStance =
  /** Generic crawlers allowed, no AI-specific bans, nothing prohibited in writing. */
  | "open"
  /** Named AI crawlers disallowed in robots.txt, generic crawling still allowed. */
  | "ai-blocked"
  /** Data mining, LLM use or dataset creation prohibited in stated terms. */
  | "prohibited"
  /** Not checked yet. */
  | "unknown";

/** How a fetch attempt ended, independent of the HTTP status. */
export type FetchOutcome =
  /** Page body returned. */
  | "ok"
  /** A bot challenge or WAF refusal — retryable with a different fetcher. */
  | "blocked"
  /** Declined on stated policy rather than suspicion. Do not retry. */
  | "refused"
  /** Network failure, timeout, DNS. */
  | "error";

/** Which client made the request. Blocking differs sharply between them. */
export type Fetcher = "raw" | "managed";

/** What a search engine returned at a position — not every result is a recipe. */
export type ResultKind = "recipe" | "video" | "social" | "roundup" | "other";

export interface SitePolicy {
  host: string;
  /** Does `User-agent: *` permit the recipe paths? Null when unchecked. */
  robotsGenericAllows: boolean | null;
  /** AI crawler user-agents given `Disallow: /`, as written in robots.txt. */
  aiCrawlersBlocked: string[];
  /** True when those bans came from an ad network block, not the site owner. */
  adNetworkInjected: boolean;
  /** True when terms prohibit data mining, RAG or dataset creation. */
  writtenProhibition: boolean;
  /** Licensing contact the site offers, when it offers one. */
  licensingContact: string | null;
  /** Free-text quote or note supporting the fields above. */
  note: string | null;
  checkedAt: string;
}

export interface SiteRecord {
  host: string;
  displayName: string;
  /** A site we deliberately trust and query directly, not just via search. */
  trusted: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface FetchAttempt {
  host: string;
  url: string;
  fetcher: Fetcher;
  /** 0 when the request never got a response. */
  status: number;
  outcome: FetchOutcome;
  cdn: string | null;
  bodyBytes: number | null;
  elapsedMs: number | null;
  /** Did the page carry a schema.org Recipe node in JSON-LD? */
  jsonLd: boolean;
  ingredientCount: number | null;
  stepCount: number | null;
  /** Kept raw, unnormalized — the spread across sites is itself a finding. */
  yieldRaw: string | null;
  totalTimeRaw: string | null;
  note: string | null;
  attemptedAt: string;
}

export interface SearchAppearance {
  host: string;
  url: string;
  /** The dish searched for, e.g. "meatloaf". */
  query: string;
  /** 1-based position in the raw result set, before filtering. */
  rank: number;
  kind: ResultKind;
  seenAt: string;
}

/**
 * One row of the site report: everything accumulated for a host.
 * Every field is sortable, which is the point of keeping it flat.
 */
export interface SiteStats {
  host: string;
  displayName: string;
  trusted: boolean;
  stance: PolicyStance;
  /** Distinct dishes this host has shown up for. */
  queries: number;
  appearances: number;
  bestRank: number | null;
  medianRank: number | null;
  fetches: number;
  ok: number;
  blocked: number;
  refused: number;
  errors: number;
  /** ok / fetches, 0-1, null when never fetched. */
  reachRate: number | null;
  /** Share of ok fetches carrying a Recipe node, 0-1, null when never ok. */
  jsonLdRate: number | null;
  /** Does a managed fetcher succeed where a raw one was blocked? */
  managedRescues: number;
  aiCrawlersBlocked: number;
  licensingContact: string | null;
  lastSeenAt: string;
}
