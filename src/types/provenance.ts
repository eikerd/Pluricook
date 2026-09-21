/**
 * Provenance: where a recipe came from, and what we are allowed to show of it.
 *
 * A recipe's identity IS its source. Two meatloaf recipes are only comparable
 * because one is Natasha's and one is RecipeTin's — strip the attribution and
 * the corpus stops being a study of how published recipes differ and becomes an
 * anonymous pile of ingredient lists, which is both less useful and less
 * defensible.
 *
 * So provenance is not metadata hanging off a recipe. It is a required field
 * with no null case: `ExtractedRecipe` cannot be constructed without it, and
 * nothing in the pipeline may mint a recipe that lacks one.
 *
 * This is deliberately stricter than the law requires. Attribution is not a
 * copyright defence — crediting a source does not make copying lawful. What it
 * does is keep the product honestly non-substitutive: readers can always reach
 * the original, which is the fact that matters most if the corpus is ever
 * questioned.
 */

import type { Acquisition } from "../lib/curated-sources";

/**
 * How a recipe's text reached us.
 *
 * Recorded per recipe rather than per site, because a site's permissions can
 * change between one capture and the next, and a stored recipe must carry the
 * basis on which it was taken — not the basis that applies today.
 */
export type CaptureMethod =
  /** Fetched by us, parsed from the page's own structured data. */
  | "structured-data"
  /** Fetched by us, parsed out of the page HTML. */
  | "html-extraction"
  /** Supplied under a licence or API agreement. */
  | "licensed-feed"
  /** Imported by a user into their own space, from their own browser. */
  | "user-import"
  /** Typed in by a person reading the page. Carries the same copyright analysis
   *  as any other copying — the method of reproduction is legally irrelevant. */
  | "manual-transcription";

export interface Provenance {
  /** Canonical host, matching the source registry. */
  host: string;
  /** Publication name as it should be credited, e.g. "RecipeTin Eats". */
  siteName: string;
  /** The exact page this recipe came from. Always shown, never hidden. */
  sourceUrl: string;
  /** Recipe author or byline where the page names one. */
  author: string | null;
  /** Recipe title as published — the source's words, not ours. */
  sourceTitle: string;
  /** When we captured it. */
  capturedAt: string;
  method: CaptureMethod;
  /** The permission basis in force at capture time (see curated-sources). */
  acquisitionAtCapture: Acquisition;
  /** Licence identifier, when the capture rested on one. */
  licence: string | null;
}

/**
 * What we hold for one recipe.
 *
 * The split is the legal architecture, expressed as a type. Ingredients and the
 * structured fields are facts and are stored. The page's own prose — headnote,
 * step wording, narrative — is the protected expression and has no field here
 * to put it in, so a careless extractor cannot quietly start storing it.
 */
export interface ExtractedRecipe {
  id: string;
  /** Required, no null case. A recipe without a source is not a recipe. */
  provenance: Provenance;

  /** The dish this was captured for, e.g. "meatloaf". */
  dish: string;

  /** Ingredient lines as published, before parsing. Facts. */
  ingredientLines: string[];

  /** Structured fields the publisher emitted for machines. */
  servings: number | null;
  totalTimeMinutes: number | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;

  /** Raw forms kept beside the normalized ones, because the spread across sites
   *  is itself a finding — `8`, `8 serving(s)` and `6 - 8 serving(s)` all mean
   *  different amounts of confidence. */
  servingsRaw: string | null;
  totalTimeRaw: string | null;

  /** Number of steps only. Deliberately a count and not the text. */
  stepCount: number | null;
}

/**
 * Reject anything that would enter the corpus without a usable source.
 *
 * Called at the extraction boundary rather than at display time: a recipe with
 * broken provenance must never be stored, because by the time it is displayed
 * the page it came from may be unreachable and the link unrecoverable.
 */
export function assertProvenance(p: Provenance): void {
  const missing = (["host", "siteName", "sourceUrl", "sourceTitle", "capturedAt"] as const)
    .filter((k) => !p[k] || String(p[k]).trim() === "");

  if (missing.length > 0) {
    throw new Error(
      `Recipe provenance is incomplete (${missing.join(", ")}). ` +
        `A recipe without a source cannot enter the corpus — its identity is its source.`,
    );
  }

  try {
    const url = new URL(p.sourceUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("not a web URL");
    }
  } catch {
    throw new Error(`Recipe provenance has an unusable sourceUrl: ${p.sourceUrl}`);
  }
}

/**
 * The credit line shown wherever a recipe appears.
 *
 * A single formatter, so attribution cannot drift between a card, a table row
 * and a chart tooltip — the failure mode that made a one-formatter rule
 * necessary for money display.
 */
export function creditLine(p: Provenance): string {
  return p.author ? `${p.siteName} — ${p.author}` : p.siteName;
}
