/**
 * The curated source list: which sites are starred, and what we may do with each.
 *
 * `data/sources/curated.json` is the source of truth, not the database. sources.db
 * is gitignored and rebuilt from data/, so a star stored only in SQLite would be
 * lost on the next rebuild — and, more importantly, a decision about what we are
 * permitted to take from a publisher belongs in version control with a reason
 * attached, not in a derived artefact.
 */

import { canonicalHost } from "./site-registry";

export const CURATED_PATH = "data/sources/curated.json";

/** Standing opinion about a site, independent of what a search happened to return. */
export type Tier =
  /** Queried directly every time, not only when a search surfaces it. */
  | "required"
  /** Preferred when it appears. */
  | "favorite"
  /** Met through search; no standing opinion. */
  | "normal"
  /** Never fetched, never stored. */
  | "blocked";

/**
 * How content from a site may legally reach the corpus.
 *
 * This is a decision, not an observation — the registry's `stance` records what
 * a site *said*, and this records what we have decided to *do* about it.
 */
export type Acquisition =
  | "fetch"
  | "licensed"
  /** Keep our own facts and link out; store no expression from the page. */
  | "link-only"
  /**
   * A person may enter recipes by hand, up to `manualCap`.
   *
   * For sites whose terms bar automated collection but where occasional,
   * attributed, facts-only entry by a human is a different act: robots.txt
   * addresses automated clients, and a browsewrap ToS accepted by nobody is
   * weak contract formation. The cap is what keeps "occasional" honest — it is
   * enforced by the system rather than remembered, because scale creep is the
   * one risk here that drifts without anyone deciding to let it.
   */
  | "manual-limited"
  | "none"
  /** Starred but not yet reviewed. Treated as `none` until it is. */
  | "pending-review";

export interface CuratedSite {
  displayName?: string;
  tier: Tier;
  acquisition: Acquisition;
  note?: string | null;
  licence?: string | null;
  /** Maximum hand-entered recipes. Only meaningful for `manual-limited`. */
  manualCap?: number | null;
}

interface CuratedFile {
  _comment?: unknown;
  sites: Record<string, CuratedSite>;
}

/**
 * What a host absent from the curated list gets: NOT fetchable.
 *
 * This was `fetch`, which made the gate open for precisely the sites nobody had
 * reviewed while the doc comment on mayFetch() claimed the opposite. An unlisted
 * host must now be cleared on evidence first — see robots.ts and the clearance
 * step in scripts/extract-dish.ts.
 */
export const DEFAULT_CURATION: CuratedSite = {
  tier: "normal",
  acquisition: "pending-review",
  note: null,
  licence: null,
};

/** Is this host explicitly in the curated list, as opposed to defaulted? */
export function isListed(file: CuratedFile, hostOrUrl: string): boolean {
  return canonicalHost(hostOrUrl) in file.sites;
}

export async function readCurated(path = CURATED_PATH): Promise<CuratedFile> {
  const file = Bun.file(path);
  if (!(await file.exists())) return { sites: {} };
  const parsed = (await file.json()) as CuratedFile;
  return { ...parsed, sites: parsed.sites ?? {} };
}

export function curationFor(
  file: CuratedFile,
  hostOrUrl: string,
): CuratedSite {
  return file.sites[canonicalHost(hostOrUrl)] ?? DEFAULT_CURATION;
}

/**
 * May we fetch this site at all?
 *
 * Deliberately closed rather than open: anything not reviewed, and anything
 * blocked, answers no. A site has to be positively cleared, which is the
 * opposite of treating "not blocked in robots.txt" as permission.
 */
export function mayFetch(site: CuratedSite): boolean {
  if (site.tier === "blocked") return false;
  // manual-limited is deliberately absent: it permits a person, not a fetcher.
  return site.acquisition === "fetch" || site.acquisition === "licensed";
}

/** Default cap when a site is set to manual-limited without naming one. */
export const DEFAULT_MANUAL_CAP = 10;

export interface ManualVerdict {
  ok: boolean;
  reason: string;
  cap: number | null;
  used: number;
}

/**
 * May a person hand-enter one more recipe from this site?
 *
 * `used` is the number already held from that host, counted from the stored
 * recipes rather than tracked separately, so deleting a recipe frees its slot
 * and the count cannot drift from what is actually published.
 */
export function mayCaptureManually(site: CuratedSite, used: number): ManualVerdict {
  const cap = site.manualCap ?? DEFAULT_MANUAL_CAP;

  if (site.tier === "blocked") {
    return { ok: false, reason: "site is blocked", cap: null, used };
  }
  if (site.acquisition === "licensed" || site.acquisition === "fetch") {
    return { ok: true, reason: `acquisition is ${site.acquisition}; no cap applies`, cap: null, used };
  }
  if (site.acquisition !== "manual-limited") {
    return {
      ok: false,
      reason: `acquisition is ${site.acquisition}, which does not permit hand entry`,
      cap: null,
      used,
    };
  }
  if (used >= cap) {
    return { ok: false, reason: `manual cap of ${cap} already reached`, cap, used };
  }
  return { ok: true, reason: `${used + 1} of ${cap}`, cap, used };
}

/** May we store text taken from the page, as opposed to our own derived facts? */
export function mayStoreSourceText(site: CuratedSite): boolean {
  return site.acquisition === "licensed";
}

export async function writeCurated(
  file: CuratedFile,
  path = CURATED_PATH,
): Promise<void> {
  // Hosts sorted so a star click produces a small, readable diff rather than
  // reordering the whole file.
  const sorted = Object.fromEntries(
    Object.entries(file.sites).sort(([a], [b]) => a.localeCompare(b)),
  );
  await Bun.write(path, JSON.stringify({ ...file, sites: sorted }, null, 2) + "\n");
}

/**
 * Set a site's tier, preserving everything else already recorded about it.
 *
 * A newly starred site gets `pending-review`, never `fetch`: starring says we
 * want the site, not that we have established we may take from it.
 */
export async function setTier(
  hostOrUrl: string,
  tier: Tier,
  opts: { displayName?: string; path?: string } = {},
): Promise<CuratedSite> {
  const path = opts.path ?? CURATED_PATH;
  const host = canonicalHost(hostOrUrl);
  const file = await readCurated(path);
  const existing = file.sites[host];

  const updated: CuratedSite = {
    ...DEFAULT_CURATION,
    ...existing,
    displayName: opts.displayName ?? existing?.displayName,
    tier,
    // A tier is an opinion about how much we want a site; an acquisition is a
    // reviewed decision about what we may take from it. Changing the first must
    // not disturb the second. Only two things set acquisition here: blocking
    // forces "none", and a site with NO entry yet starts at pending-review.
    //
    // This used to reset "fetch" on every star, from when "fetch" was merely the
    // unreviewed default. It is now an explicit clearance, and a star click was
    // silently revoking it — disabling extraction from a site someone had cleared.
    acquisition:
      tier === "blocked" ? "none" : (existing?.acquisition ?? "pending-review"),
  };

  file.sites[host] = updated;
  await writeCurated(file, path);
  return updated;
}
