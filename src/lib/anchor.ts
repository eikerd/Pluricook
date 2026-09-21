/**
 * Choosing the reference ingredient a dish is normalized against.
 *
 * A recipe is a composition: doubling it changes nothing about what it is, so
 * absolute mass carries no information and "per serving" only adds an author's
 * opinion about appetite. What is meaningful is the ratio between parts. The
 * anchor is the part everything else is stated against.
 *
 * The idea has three independent pedigrees:
 *   - Baker's percentage: flour is 100%, everything else a percent of it — and
 *     where there is no flour, "the ingredient of the highest proportion".
 *   - Charcuterie formulation: salt, cure and spice as a percent of meat weight.
 *   - Compositional data analysis (Aitchison 1982, 1986): the additive log-ratio
 *     transform takes one part as the reference; the centered log-ratio needs
 *     none, using the geometric mean of all parts instead.
 *
 * The anchor is chosen PER DISH, never per recipe. If one meatloaf were stated
 * against its meat and another against its crumbs, their percentages would not
 * be comparable, which would defeat the point of normalizing at all.
 *
 * The hierarchy, first that qualifies across the corpus:
 *   1. meat      — the owner's rule for any dish built on it
 *   2. grain     — baker's percentage and its cousins (flour, rice, pasta)
 *   3. legume    — the usual backbone of a vegetarian main
 *   4. dominant  — whichever remaining class leads, per the baker's fallback
 *   5. clr       — no part qualifies; use the geometric mean of all parts
 */

export type FoodClass =
  | "meat" | "grain" | "legume" | "vegetable" | "dairy" | "fruit"
  | "nut" | "fat" | "sweet"
  /** Water, stock, condiments, spices: never an anchor, however large. */
  | "unanchorable";

/**
 * Map a USDA category to our class.
 *
 * Two coding systems are in play: SR Legacy and Foundation use ids 1–25, while
 * FNDDS survey foods use four-digit WWEIA codes. Reading only the first system
 * is how "Meat, ground, NFS" (WWEIA 2004) once counted as not-meat, leaving a
 * whole recipe without a reference mass.
 */
export function classifyCategory(categoryId: number | null): FoodClass {
  if (categoryId === null) return "unanchorable";
  const c = categoryId;

  if (c < 100) {
    if ([5, 7, 10, 13, 15, 17].includes(c)) return "meat";
    if (c === 20) return "grain";
    if (c === 16) return "legume";
    if (c === 11) return "vegetable";
    if (c === 1) return "dairy";     // SR's "Dairy and Egg Products"
    if (c === 9) return "fruit";
    if (c === 12) return "nut";
    if (c === 4) return "fat";
    if (c === 19) return "sweet";
    return "unanchorable";           // spices 2, soups & sauces 6, beverages 14, baked 18 …
  }

  // WWEIA four-digit codes.
  if ((c >= 2002 && c <= 2010) || (c >= 2202 && c <= 2206) ||
      (c >= 2402 && c <= 2404) || (c >= 2602 && c <= 2608)) return "meat";
  if (c === 4002 || c === 4004 || c === 4802 || c === 4804) return "grain";
  if (c === 2802 || c === 2806) return "legume";
  if ((c >= 6402 && c <= 6489) || (c >= 6802 && c <= 6806)) return "vegetable";
  if ((c >= 1002 && c <= 1904) || c === 2502) return "dairy";
  if (c >= 6002 && c <= 6024) return "fruit";
  if (c === 2804) return "nut";
  if (c >= 8002 && c <= 8012) return "fat";
  if (c >= 8802 && c <= 8806) return "sweet";
  return "unanchorable";
}

/** One recipe, reduced to what anchoring needs. */
export interface Composition {
  recipeId: string;
  parts: Array<{ klass: FoodClass; grams: number }>;
}

export interface AnchorCandidate {
  klass: FoodClass;
  /** Share of recipes in which this class appears at all. */
  presence: number;
  /** Median share of anchorable mass, among recipes where it appears. */
  medianShare: number;
  qualifies: boolean;
}

export type AnchorDecision =
  | {
      kind: "class";
      klass: FoodClass;
      /** How it was chosen: by priority, or as the leading remaining class. */
      via: "priority" | "dominant";
      unitLabel: string;
      reason: string;
      candidates: AnchorCandidate[];
    }
  | { kind: "clr"; unitLabel: string; reason: string; candidates: AnchorCandidate[] };

export interface AnchorOptions {
  /** A class must appear in at least this share of recipes. */
  minPresence?: number;
  /** …and hold at least this median share of anchorable mass. */
  minShare?: number;
}

const PRIORITY: FoodClass[] = ["meat", "grain", "legume"];
const FALLBACK: FoodClass[] = ["vegetable", "dairy", "fruit", "nut", "fat", "sweet"];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Mass of one class within one recipe. */
export function classMass(c: Composition, klass: FoodClass): number {
  return c.parts.reduce((n, p) => (p.klass === klass ? n + p.grams : n), 0);
}

/**
 * Pick the anchor for a dish from every recipe captured for it.
 *
 * Shares are taken over ANCHORABLE mass only. Water and stock would otherwise
 * swamp a soup and make its lentils look incidental, when they are the dish.
 */
export function chooseAnchor(
  compositions: Composition[],
  opts: AnchorOptions = {},
): AnchorDecision {
  const minPresence = opts.minPresence ?? 0.75;
  const minShare = opts.minShare ?? 0.2;

  const assess = (klass: FoodClass): AnchorCandidate => {
    const shares: number[] = [];
    for (const c of compositions) {
      const total = c.parts.reduce((n, p) => (p.klass === "unanchorable" ? n : n + p.grams), 0);
      const mass = classMass(c, klass);
      if (mass > 0 && total > 0) shares.push(mass / total);
    }
    const presence = compositions.length > 0 ? shares.length / compositions.length : 0;
    const medianShare = median(shares);
    return {
      klass,
      presence: Math.round(presence * 100) / 100,
      medianShare: Math.round(medianShare * 100) / 100,
      qualifies: presence >= minPresence && medianShare >= minShare,
    };
  };

  const candidates = [...PRIORITY, ...FALLBACK].map(assess);
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  for (const klass of PRIORITY) {
    const cand = candidates.find((x) => x.klass === klass)!;
    if (cand.qualifies) {
      return {
        kind: "class", klass, via: "priority", unitLabel: `% of ${klass}`, candidates,
        reason: `${klass} appears in ${pct(cand.presence)} of recipes at a median ` +
          `${pct(cand.medianShare)} of their mass`,
      };
    }
  }

  // The baker's fallback: no flour, so take the ingredient of highest proportion.
  const leader = candidates
    .filter((x) => FALLBACK.includes(x.klass) && x.qualifies)
    .sort((a, b) => b.medianShare - a.medianShare)[0];

  if (leader) {
    return {
      kind: "class", klass: leader.klass, via: "dominant",
      unitLabel: `% of ${leader.klass}`, candidates,
      reason: `no meat, grain or legume backbone; ${leader.klass} leads at a median ` +
        `${pct(leader.medianShare)} of mass in ${pct(leader.presence)} of recipes`,
    };
  }

  return {
    kind: "clr", unitLabel: "× geometric mean", candidates,
    reason: `no class reaches ${pct(minPresence)} presence and ${pct(minShare)} share — ` +
      `each part is stated against the geometric mean of its recipe (centered log-ratio)`,
  };
}

/**
 * Geometric mean of a recipe's part masses — the clr reference.
 *
 * Taken over the parts present, the standard practical handling of zeros in
 * compositional data: an absent ingredient is not a tiny amount of it.
 */
export function geometricMean(grams: number[]): number | null {
  const positive = grams.filter((g) => g > 0);
  if (positive.length === 0) return null;
  return Math.exp(positive.reduce((n, g) => n + Math.log(g), 0) / positive.length);
}

/** A part's amount relative to the dish's anchor, in the anchor's own unit. */
export function relativeAmount(
  anchor: AnchorDecision,
  composition: Composition,
  grams: number,
): number | null {
  if (anchor.kind === "class") {
    const ref = classMass(composition, anchor.klass);
    return ref > 0 ? Math.round((grams / ref) * 10000) / 100 : null;   // percent, 2 dp
  }
  const gm = geometricMean(composition.parts.map((p) => p.grams));
  return gm ? Math.round((grams / gm) * 100) / 100 : null;             // ratio, 2 dp
}
