/**
 * Import a personal comparison matrix — ingredients down the side, sources
 * across the top — as one attributed recipe per source.
 *
 * This is how people who compare recipes actually keep notes: a spreadsheet of
 * gram weights compiled over time from blogs, videos and cookbooks. The layout
 * is the inverse of a recipe page, so rather than ask for it to be re-typed one
 * recipe at a time, each COLUMN becomes a recipe and each cell becomes an
 * ordinary ingredient line. Everything downstream — gram conversion, the alias
 * table, anchoring, comparison — then runs on it unchanged.
 *
 * Attribution survives the trip: every column names its source, and a column
 * with no URL on file is imported PRIVATE, because the public app's posture is
 * that it sends readers to the source and these have nowhere to send them yet.
 */

import { mayCaptureManually, mayFetch, type CuratedSite } from "./curated-sources";
import { canonicalHost } from "./site-registry";
import type { ExtractedRecipe, Visibility } from "../types/provenance";

/** One source column of the matrix. */
export interface CollectionSource {
  /** Column key, matching the keys used in each row's cells. */
  key: string;
  siteName: string;
  author?: string | null;
  /** The page or video. May be absent in old notes; the recipe is then private. */
  sourceUrl?: string | null;
  /** Title as published, when known. */
  sourceTitle?: string | null;
  /** True for the owner's own recipe: the internal record is its source. */
  ownWork?: boolean;
  note?: string | null;
}

export interface CollectionFile {
  dish: string;
  /** What a bare number means in this sheet. Only grams is supported. */
  convention: "bare-numbers-are-grams";
  compiledBy: string;
  compiledAt: string;
  sources: CollectionSource[];
  sections: Array<{
    name: string;
    rows: Array<{ ingredient: string; cells: Record<string, string | number | null> }>;
  }>;
}

export type Cell =
  | { kind: "empty" }
  /** A bare number, or a number with g/kg — a mass. */
  | { kind: "grams"; grams: number; variant: string | null }
  /** A number with a volume or other unit: "1 Tb", "28 oz", "30ml", "1/4 tsp". */
  | { kind: "measured"; quantity: string; unit: string }
  /** A count, optionally sized: "3 med", or a bare fraction like "1/4". */
  | { kind: "count"; quantity: string; size: string | null }
  /** "taste", "to taste", "pinch" — present, but deliberately unquantified. */
  | { kind: "unquantified"; text: string };

const SIZE_WORDS: Record<string, string> = {
  sm: "small", small: "small", med: "medium", medium: "medium", lg: "large", large: "large",
};

/**
 * Shorthand a note-taker uses for a substituted ingredient. "AP 315" in the
 * bread-flour row means 315 g of all-purpose flour instead.
 */
const VARIANTS: Record<string, string> = {
  ap: "all-purpose flour",
};

/**
 * Read one cell of the matrix.
 *
 * The sheet's convention is that a bare number is grams — but a bare FRACTION
 * is a count, since nobody writes a quarter of a gram as "1/4" and the row it
 * appears in ("Onion: 1/4") confirms it.
 */
export function parseCell(raw: string | number | null | undefined): Cell {
  if (raw === null || raw === undefined) return { kind: "empty" };
  const text = String(raw).trim();
  if (text === "") return { kind: "empty" };

  if (/^(to\s+)?taste$|^pinch$|^dash$|^optional$/i.test(text)) {
    return { kind: "unquantified", text: text.toLowerCase() };
  }

  // "AP 315" — a variant tag, then grams.
  const tagged = /^([a-z][a-z-]*)\s+(\d+(?:\.\d+)?)\s*g?$/i.exec(text);
  if (tagged) {
    return { kind: "grams", grams: Number(tagged[2]), variant: tagged[1]!.toLowerCase() };
  }

  // "273", "4.1", "300g", "300 g"
  const grams = /^(\d+(?:\.\d+)?)\s*(g|grams?)?$/i.exec(text);
  if (grams) return { kind: "grams", grams: Number(grams[1]), variant: null };

  // A bare fraction is a count: "1/4" of an onion.
  if (/^\d+\s*\/\s*\d+$/.test(text) || /^\d+\s+\d+\/\d+$/.test(text)) {
    return { kind: "count", quantity: text.replace(/\s*\/\s*/, "/"), size: null };
  }

  // quantity + word: "1 Tb", "28 oz", "30ml", "1/4 tsp", "3 med"
  const measured = /^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*([a-z][a-z .]*)$/i.exec(text);
  if (measured) {
    const quantity = measured[1]!;
    const word = measured[2]!.trim().toLowerCase().replace(/\.$/, "");
    if (SIZE_WORDS[word]) return { kind: "count", quantity, size: SIZE_WORDS[word]! };
    return { kind: "measured", quantity, unit: word };
  }

  // Anything else is kept verbatim as unquantified rather than guessed at.
  return { kind: "unquantified", text };
}

/**
 * Turn a cell into an ordinary ingredient line.
 *
 * The line is synthetic but faithful: it says exactly what the cell said, in the
 * shape every other recipe in the corpus already has, so no downstream code
 * needs to know this recipe began life as a spreadsheet column.
 */
export function cellToLine(ingredient: string, cell: Cell): string | null {
  const name = ingredient.trim().toLowerCase();
  switch (cell.kind) {
    case "empty":
      return null;
    case "grams": {
      // A row named for what it counts ("garlic cloves") holds counts, not grams.
      if (/\b(cloves?|stalks?|sprigs?|leaves|eggs?)\b/.test(name) && cell.variant === null) {
        return `${cell.grams} ${name}`;
      }
      const food = cell.variant ? (VARIANTS[cell.variant] ?? `${name} (${cell.variant})`) : name;
      return `${cell.grams} g ${food}`;
    }
    case "measured":
      return `${cell.quantity} ${cell.unit} ${name}`;
    case "count":
      return `${cell.quantity} ${cell.size ? `${cell.size} ` : ""}${name}`;
    case "unquantified":
      return `${name}, to taste`;
  }
}

export interface VisibilityDecision {
  visibility: Visibility;
  reason: string;
}

/**
 * Decide whether an imported recipe may be public.
 *
 * Private is the default and costs nothing: the owner's own analysis still runs
 * on it. Public requires a link to credit AND a source the curated list allows —
 * importing from notes must not become a side door around the permission review
 * that fetching and hand entry both go through.
 */
export function decideVisibility(
  site: CuratedSite,
  hasUrl: boolean,
  manualAlreadyHeld: number,
  ownWork = false,
): VisibilityDecision {
  if (ownWork) {
    return { visibility: "public", reason: "the owner's own recipe — the internal record is its source" };
  }
  if (!hasUrl) {
    return { visibility: "private", reason: "no source URL on file — add one to make it publishable" };
  }
  if (mayFetch(site)) {
    return { visibility: "public", reason: `source permits fetching (${site.acquisition})` };
  }
  const manual = mayCaptureManually(site, manualAlreadyHeld);
  if (manual.ok) {
    return { visibility: "public", reason: `hand entry permitted: ${manual.reason}` };
  }
  return { visibility: "private", reason: `source not cleared — ${manual.reason}` };
}

/** Build one recipe per source column. Visibility is decided by the caller. */
export function matrixToRecipes(file: CollectionFile): ExtractedRecipe[] {
  return file.sources.map((source): ExtractedRecipe => {
    const sections = file.sections
      .map((section) => ({
        name: section.name,
        ingredientLines: section.rows
          .map((row) => cellToLine(row.ingredient, parseCell(row.cells[source.key])))
          .filter((line): line is string => line !== null),
      }))
      .filter((s) => s.ingredientLines.length > 0);

    const url = source.sourceUrl?.trim() || null;

    return {
      id: `personal:${file.dish}:${source.key}`,
      provenance: {
        host: url ? canonicalHost(url) : null,
        siteName: source.siteName,
        sourceUrl: url,
        author: source.author ?? null,
        sourceTitle: source.sourceTitle?.trim() || `${file.dish} (from ${file.compiledBy}'s notes)`,
        capturedAt: file.compiledAt,
        method: "personal-collection",
        acquisitionAtCapture: "pending-review",
        licence: null,
        ...(source.ownWork ? { ownWork: true } : {}),
      },
      visibility: "private",
      dish: file.dish,
      sections,
      ingredientLines: sections.flatMap((s) => s.ingredientLines),
      // A comparison matrix records formulas, not yields or timings.
      servings: null, servingsRaw: null,
      totalTimeMinutes: null, totalTimeRaw: null,
      prepTimeMinutes: null, cookTimeMinutes: null,
      stepCount: null,
    };
  });
}
