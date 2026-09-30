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
  | "manual-transcription"
  /**
   * Brought in from the owner's own notes — a spreadsheet of gram weights
   * compiled from blogs, videos and cookbooks over time. The source is known by
   * name but may not have a URL on file, and the notes predate any permission
   * review, so these enter PRIVATE and become public only once they have a link
   * to credit and the curated list allows that source.
   */
  | "personal-collection"
  /**
   * The owner's own copy of another recipe, to develop (src/lib/clones.ts).
   * Private; `clonedFrom` names the recipe it began as, whose credit it keeps
   * in its title. It has no page of its own to link to.
   */
  | "owner-copy";

export interface Provenance {
  /** Canonical host, matching the source registry. Null only for a
   *  personal-collection recipe whose page has not been looked up yet. */
  host: string | null;
  /** Publication name as it should be credited, e.g. "RecipeTin Eats". */
  siteName: string;
  /** The exact page this recipe came from. Always shown, never hidden.
   *  Null only for a personal-collection recipe — which is then private. */
  sourceUrl: string | null;
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
  /**
   * True when the recipe is the owner's own work — a family recipe, something
   * they developed. There is no external page to credit because the internal
   * record IS the source, and the owner holds the rights to publish it.
   */
  ownWork?: boolean;
}

/**
 * What we hold for one recipe.
 *
 * The split is the legal architecture, expressed as a type. Ingredients and the
 * structured fields are facts and are stored. The page's own prose — headnote,
 * step wording, narrative — is the protected expression and has no field here
 * to put it in, so a careless extractor cannot quietly start storing it.
 */
/**
 * Who may see a recipe.
 *
 * `private` is the owner's own analysis — it takes part in comparisons on their
 * machine and is never served to anyone else. Everything the public app shows
 * must be `public`, which requires a URL to link to and a source the curated
 * list permits. Absent means public: every fetched recipe predates this field.
 */
export type Visibility = "public" | "private";

export interface ExtractedRecipe {
  id: string;
  /** Required, no null case. A recipe without a source is not a recipe. */
  provenance: Provenance;
  visibility?: Visibility;
  /** Why a recipe is private, so the path to publishing it is visible. */
  visibilityReason?: string;
  /** For the owner's copy of a recipe: the id of the recipe it began as. */
  clonedFrom?: string;
  /**
   * Ingredient lines grouped as the source grouped them — dough and sauce,
   * marinade and glaze. `ingredientLines` stays the flat union so everything
   * downstream keeps working; this adds the structure without replacing it.
   */
  sections?: Array<{ name: string; ingredientLines: string[] }>;

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
  // A personal-collection recipe may arrive before its page has been looked up:
  // the owner's notes say "Chef John", not a URL. The owner's own copy has no
  // page at all. Both must still name their source. Every other method has a
  // page by construction, so there the link is required.
  const required =
    p.method === "personal-collection" || p.method === "owner-copy"
      ? (["siteName", "sourceTitle", "capturedAt"] as const)
      : (["host", "siteName", "sourceUrl", "sourceTitle", "capturedAt"] as const);

  const missing = required.filter((k) => !p[k] || String(p[k]).trim() === "");

  if (missing.length > 0) {
    throw new Error(
      `Recipe provenance is incomplete (${missing.join(", ")}). ` +
        `A recipe without a source cannot enter the corpus — its identity is its source.`,
    );
  }

  if (p.sourceUrl === null || p.sourceUrl === "") return;   // allowed above, or already reported

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
 * May this recipe be shown to anyone but the owner?
 *
 * The public app's whole legal posture is that it sends readers to the source.
 * A recipe with nowhere to send them cannot be part of that, however well it is
 * credited by name — so no URL means not publishable, without exception.
 */
export function isPublishable(r: ExtractedRecipe): boolean {
  if ((r.visibility ?? "public") !== "public") return false;
  // The owner's own recipe needs no outbound link: its internal record is the source.
  return Boolean(r.provenance.sourceUrl) || r.provenance.ownWork === true;
}

/**
 * Every recipe's home inside this system, whatever its origin.
 *
 * External recipes link OUT to their source for credit; this is where the app
 * itself keeps the record — the page that shows its normalized form, its
 * provenance, and, for a personal-collection recipe, the place to add the URL
 * that would make it publishable.
 */
export function internalRef(r: Pick<ExtractedRecipe, "id">): string {
  return `/recipes/${encodeURIComponent(r.id)}`;
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
