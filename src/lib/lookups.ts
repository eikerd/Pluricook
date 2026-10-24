/**
 * The pages a dish run was denied, kept for a person to look up by hand.
 *
 * The owner, 2026-09-30: "keep a list of the websites that were denied so we
 * can have someone look those up personally." A denied page is a recipe the
 * corpus is missing; a person may read a page a crawler may not take — within
 * the site's acquisition rule, which each entry carries so the reader knows it.
 *
 * Stored per dish at data/lookups/<dish>.json. A person's notes survive re-runs.
 */

import type { Acquisition } from "./curated-sources";
import type { ExtractFailure } from "./recipe-extract";
import { canonicalUrl } from "./site-registry";

/**
 * not-cleared — absent from the curated list and robots.txt did not clear it
 * policy      — curated, but our own rule says do not fetch (none, pending-review…)
 * blocked     — curated as blocked: a written prohibition; nothing is stored
 * refused     — the site said no (HTTP 401/403/429, a bot challenge)
 * unreachable — any other HTTP error, a timeout, a network failure
 * evasion-suspected — the page answered but gave automation no recipe to read:
 *               no structured data, no Recipe in it, or one with no ingredients.
 *               The owner, 2026-09-30: count these as possible bot evasion, and
 *               have a person check the page in a browser.
 */
export type Denial = "not-cleared" | "policy" | "blocked" | "refused" | "unreachable" | "evasion-suspected";

/** Where the person working the list finds what to do with each kind. */
export const LOOKUPS_HOW_TO = "docs/manual-lookups.md";

export interface DeniedPage {
  url: string;
  site: string;
  denial: Denial;
  /** What the run reported, e.g. "HTTP 403" or "normal · none". */
  detail: string;
  /** The curated acquisition rule at the time, or null for an unlisted host. */
  acquisition: Acquisition | null;
  /**
   * Extraction rules that acted on a page that then failed, and whether it would
   * have extracted without each. A rule that turns a page away (G33) can only
   * leave its evidence here, since no recipe is stored (rule-scores.ts).
   */
  extractionRules?: Array<{ id: string; changed: boolean }>;
}

export interface Lookup extends DeniedPage {
  firstDeniedAt: string;
  lastDeniedAt: string;
  /** Filled in by the person who looked it up. Never written by a run. */
  handledAt: string | null;
  note: string | null;
  /**
   * The person's judgement of the kind: true when the page really was what its
   * denial says (a recipe hidden from automation, a real block), false when not
   * (no recipe there at all). Scores the gate (rule-scores.ts). Never written by a run.
   */
  confirmed?: boolean | null;
  /** Set when a later run extracted the page; it then lives in the file's `resolved`, not `pages`. */
  resolvedAt?: string;
}

/** Which kind of denial an HTTP status is. */
export function denialForStatus(status: number): Denial {
  return status === 401 || status === 403 || status === 429 ? "refused" : "unreachable";
}

/**
 * A page that answered without a usable recipe. Every extraction failure is
 * treated alike on purpose: from outside, a page that hides its recipe from
 * automation and one that never marked it up look the same, and telling them
 * apart is exactly the check the person makes.
 */
export function denialForExtractFailure(_reason: ExtractFailure): Denial {
  return "evasion-suspected";
}

/**
 * The held pages this run extracted. They leave the person's list, but a
 * verdict on their gate is scoring evidence (rule-scores.ts), so they are kept
 * in the file's `resolved` list rather than dropped.
 */
export function resolvedThisRun(held: Lookup[], extractedUrls: string[], today: string): Lookup[] {
  const extracted = new Set(extractedUrls.map(canonicalUrl));
  return held.filter((l) => extracted.has(canonicalUrl(l.url))).map((l) => ({ ...l, resolvedAt: today }));
}

/**
 * Fold one run into the held list.
 *
 * - a page denied again keeps its first date and the person's handledAt/note,
 *   and their `confirmed` only while the kind it judged is unchanged;
 * - a page extracted this run leaves the list — it is no longer missing;
 * - a page this run never touched is kept as it was: silence is not success.
 */
export function mergeLookups(
  held: Lookup[],
  denied: DeniedPage[],
  extractedUrls: string[],
  today: string,
): Lookup[] {
  const extracted = new Set(extractedUrls.map(canonicalUrl));
  const byUrl = new Map<string, Lookup>();
  for (const l of held) {
    if (!extracted.has(canonicalUrl(l.url))) byUrl.set(canonicalUrl(l.url), l);
  }
  for (const d of denied) {
    const key = canonicalUrl(d.url);
    const prior = byUrl.get(key);
    byUrl.set(key, {
      ...d,
      firstDeniedAt: prior?.firstDeniedAt ?? today,
      lastDeniedAt: today,
      handledAt: prior?.handledAt ?? null,
      note: prior?.note ?? null,
      // A confirmation judged one kind of denial; a new kind has not been judged.
      confirmed: prior?.denial === d.denial ? (prior.confirmed ?? null) : null,
    });
  }
  return [...byUrl.values()].sort((a, b) => a.site.localeCompare(b.site) || a.url.localeCompare(b.url));
}
