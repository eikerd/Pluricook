/**
 * Normalizers for the fields schema.org publishers actually emit.
 *
 * Every shape handled here was observed in the wild, not imagined. Research on
 * 2026-09-20 found seven incompatible `recipeYield` shapes, four
 * `recipeInstructions` shapes, durations that are not ISO-8601 despite the
 * field's definition, and HTML entities leaking into JSON-LD strings.
 *
 * The rule throughout: return null rather than guess. A wrong number that looks
 * plausible is worse than a missing one, because a missing one shows up in the
 * admin as an empty cell and a wrong one silently skews a comparison.
 */

/** Decode the handful of HTML entities that show up inside JSON-LD strings. */
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  deg: "°", frac12: "½", frac14: "¼", frac34: "¾", frac13: "⅓", frac23: "⅔",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", eacute: "é", egrave: "è", uuml: "ü",
};

/**
 * Strip tags and decode entities from a JSON-LD string field.
 *
 * Budget Bytes and RecipeTin Eats both emit entities inside `description` and
 * `recipeInstructions`, and some publishers leave `<p>` and `<a>` tags in.
 */
export function cleanText(input: unknown): string | null {
  if (typeof input !== "string") return null;

  const text = input
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();

  return text === "" ? null : text;
}

/**
 * Parse a duration into whole minutes.
 *
 * ISO-8601 is what the schema specifies, and most publishers emit it — including
 * non-canonical forms like `PT80M` (not normalised to 1h20m) and `PT01H30M`
 * (zero-padded). But Bon Appétit emits `"40 minutes"` as free text, so the
 * fallback is not optional.
 *
 * Days are handled because a few slow-cooker and curing recipes use `P1DT2H`.
 */
export function parseDuration(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input) && input >= 0) {
    return Math.round(input);
  }
  const raw = cleanText(input);
  if (!raw) return null;

  // ISO-8601: P[n]DT[n]H[n]M[n]S, any part optional, case-insensitive in practice.
  const iso = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
    .exec(raw.replace(/\s/g, ""));
  if (iso && (iso[1] || iso[2] || iso[3] || iso[4])) {
    const [, d, h, m, s] = iso;
    const minutes =
      Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(m ?? 0) + Number(s ?? 0) / 60;
    return minutes > 0 ? Math.round(minutes) : null;
  }

  // Free text: "1 hour 25 minutes", "40 minutes", "1 hr 5 min", "90 mins".
  let total = 0;
  let matched = false;
  for (const [re, factor] of [
    [/(\d+(?:\.\d+)?)\s*(?:days?|d)\b/gi, 1440],
    [/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/gi, 60],
    [/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/gi, 1],
  ] as const) {
    for (const match of raw.matchAll(re)) {
      total += Number(match[1]) * factor;
      matched = true;
    }
  }

  return matched && total > 0 ? Math.round(total) : null;
}

export interface ParsedYield {
  /** Servings as a number, when one can be read honestly. */
  servings: number | null;
  /** The string exactly as published, always kept. */
  raw: string;
}

/**
 * Read a servings count out of `recipeYield`.
 *
 * Shapes observed: `['6']`, `'4'`, `6`, `['18','1 loaf']`, `'1 loaf, 10 serving(s)'`,
 * `'Makes 16'`, `'1 loaf (16 pieces)'`, `'6 - 8 serving(s)'`, `'7 slices'`.
 *
 * A range takes its LOW end, not an average: "serves 6-8" means six people are
 * certainly fed, and understating per-serving nutrition would be the worse error.
 */
export function parseYield(input: unknown): ParsedYield | null {
  // An array may carry a bare count and a description; prefer whichever yields a number.
  if (Array.isArray(input)) {
    const parts = input.map((v) => parseYield(v)).filter((p): p is ParsedYield => p !== null);
    if (parts.length === 0) return null;
    const withNumber = parts.find((p) => p.servings !== null);
    return { servings: withNumber?.servings ?? null, raw: parts.map((p) => p.raw).join(", ") };
  }

  if (typeof input === "number" && Number.isFinite(input)) {
    return { servings: input > 0 ? Math.round(input) : null, raw: String(input) };
  }

  const raw = cleanText(input);
  if (!raw) return null;

  // Prefer a number attached to a serving word, so "1 loaf, 10 servings" reads 10
  // rather than 1. Without that, "1 loaf (16 pieces)" would claim a single serving.
  const serving =
    /(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(?:\d+(?:\.\d+)?)?\s*(?:servings?|serving\(s\)|portions?|people|pieces?|slices?)/i
      .exec(raw);
  if (serving) return { servings: Math.round(Number(serving[1])), raw };

  // Otherwise the first number in the string, which covers "Makes 16" and "6 - 8".
  const first = /(\d+(?:\.\d+)?)/.exec(raw);
  return { servings: first ? Math.round(Number(first[1])) : null, raw };
}

/**
 * Count instruction steps without keeping the step text.
 *
 * Deliberate: step wording is the publisher's expression and has no home in our
 * schema. The count is a fact about the recipe and is useful for comparison.
 *
 * Four shapes exist. `HowToSection` nesting is the dangerous one — a flat parser
 * returns the number of *sections* instead of steps, which silently under-counts
 * (RecipeTin Eats groups its steps this way).
 */
export function countSteps(input: unknown): number | null {
  if (typeof input === "string") {
    const text = cleanText(input);
    if (!text) return null;
    // A single string is sometimes one step, sometimes a whole method with
    // numbering. Count numbered markers when present, else treat it as one.
    const numbered = text.match(/(?:^|\s)\d+[.)]\s/g);
    return numbered && numbered.length > 1 ? numbered.length : 1;
  }

  if (!Array.isArray(input)) return null;

  let count = 0;
  for (const node of input) {
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      const type = Array.isArray(o["@type"]) ? o["@type"][0] : o["@type"];
      if (type === "HowToSection" && Array.isArray(o.itemListElement)) {
        count += o.itemListElement.length;
        continue;
      }
    }
    count += 1;
  }

  return count > 0 ? count : null;
}

/**
 * Ingredient lines, cleaned but not parsed.
 *
 * Quantity parsing belongs to the ingredient parser; this only guarantees an
 * array of non-empty strings. `PropertyValue` objects are handled because
 * schema.org's own example uses them and real importers drop them silently,
 * leaving the ingredients field blank.
 */
export function ingredientLines(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : input == null ? [] : [input];

  return raw
    .map((item) => {
      if (typeof item === "string") return cleanText(item);
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        // { "@type": "PropertyValue", value: "3/4", name: "sugar", unitCode: "G21" }
        const parts = [o.value, o.unitText, o.name].map(cleanText).filter(Boolean);
        return parts.length > 0 ? parts.join(" ") : null;
      }
      return null;
    })
    .filter((line): line is string => line !== null);
}

/**
 * Read an author name from a field that may be a string, an object or an array.
 *
 * Measured shapes: string (Food.com), object (Budget Bytes, Delish), array
 * (Bon Appétit, BBC Good Food, Taste of Home, Love and Lemons).
 */
export function parseAuthor(input: unknown): string | null {
  if (Array.isArray(input)) {
    const names = input.map(parseAuthor).filter((n): n is string => n !== null);
    return names.length > 0 ? names.join(", ") : null;
  }
  if (typeof input === "string") return cleanText(input);
  if (input && typeof input === "object") {
    return cleanText((input as Record<string, unknown>).name);
  }
  return null;
}
