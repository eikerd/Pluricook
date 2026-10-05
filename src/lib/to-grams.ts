/**
 * Convert a measured ingredient into grams.
 *
 * Grams are the source of truth for comparison; imperial is a display
 * conversion handled later. Nothing here guesses: a conversion that cannot be
 * grounded returns a reason instead of a number, because a plausible-looking
 * wrong mass is worse than a gap — it silently skews every comparison built on
 * it, and there is no way to spot it downstream.
 *
 * Density is keyed by (food, condition), not by ingredient alone. USDA carries
 * the condition in two places and both are needed: the food description
 * ("Spices, oregano, dried") and the portion modifier ("tsp, leaves" vs
 * "tsp, ground"). Those two differ by 80% for the same dried oregano.
 */

import type { Database } from "bun:sqlite";
import { EMPTY_TABLE, resolveAlias, type AliasTable } from "./ingredient-aliases";
import { dryFactor, waterOf, type OwnForm } from "./not-in-usda";
import { rule } from "./rules";

/** Units that are a mass already — no food lookup needed. */
const MASS_GRAMS: Record<string, number> = {
  g: 1, gram: 1, grams: 1, gm: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  mg: 0.001, milligram: 0.001, milligrams: 0.001,
  oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
  lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
};

/** Spelling variants collapsed to the form USDA's modifiers tend to use. */
const UNIT_ALIASES: Record<string, string> = {
  c: "cup", cups: "cup",
  tbsp: "tbsp", tbs: "tbsp", tb: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", t: "tsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  "fl oz": "fl oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml",
  l: "liter", liter: "liter", liters: "liter", litre: "liter",
  pt: "pint", pint: "pint", pints: "pint",
  qt: "quart", quart: "quart", quarts: "quart",
  clove: "clove", cloves: "clove",
  slice: "slice", slices: "slice",
  stick: "stick", sticks: "stick",
  can: "can", cans: "can",
  large: "large", medium: "medium", small: "small",
};

/**
 * Volume units expressed in millilitres, used only as a last resort.
 *
 * Converting volume to mass without a density is guessing, so these are NOT
 * applied on their own — they exist to translate a recipe's unit into the
 * measure USDA actually published for that food (usually a cup).
 */
const ML: Record<string, number> = {
  cup: 236.588, tbsp: 14.7868, tsp: 4.92892,
  "fl oz": 29.5735, ml: 1, liter: 1000, pint: 473.176, quart: 946.353,
};

export type Basis =
  /** The unit was already a mass. Exact. */
  | "direct-mass"
  /** Matched a USDA portion whose measure and condition both fit. */
  | "usda-portion"
  /** Scaled from a USDA portion in a different but convertible volume unit. */
  | "usda-portion-scaled"
  /** No food matched in USDA. */
  | "no-food-match"
  /** Food matched, but it publishes no portion for this unit. */
  | "no-portion-match"
  /** The unit is not one we can reason about (e.g. "to taste", "pinch"). */
  | "unconvertible-unit"
  /** Our alias table says this phrase is not a food at all. */
  | "rejected-by-alias"
  /** A food the USDA datasets we load lack, converted by our own spec (not-in-usda.json). */
  | "not-in-usda"
  /** A form USDA lacks (fresh noodles), counted as another record's dry matter (G22). */
  | "counted-as-dry";

export interface GramResult {
  grams: number | null;
  basis: Basis;
  /** The USDA record used, so a surprising number can be traced back. */
  fdcId: number | null;
  foodDescription: string | null;
  /** The portion row relied on, e.g. "1 tsp, ground = 1.8 g". */
  portionUsed: string | null;
  /** Free-text note when the conversion is approximate or refused. */
  note: string | null;
  /**
   * Set when the line leaned on our not-in-usda table instead of USDA, in a
   * few words fit for a tag: "not in USDA", "fresh, counted as dry ×0.77".
   */
  workaround: string | null;
}

export function normalizeUnit(unit: string): string {
  const u = unit.trim().toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[u] ?? u;
}

interface FoodRow { fdc_id: number; description: string }

/**
 * Words describing preparation, not identity.
 *
 * These must never reach the search index. The FTS tokenizer is a Porter
 * stemmer, so "chopped" stems to "chop" and matches "Pork, chop, center cut" —
 * which is how "1 medium onion, finely chopped" was resolving to pork. Likewise
 * "minced" matched "Ham, minced". Preparation belongs in `condition`, where it
 * selects between portions, not in the query that decides what the food IS.
 */
// NB: "ground" is deliberately absent. It identifies a food at least as often
// as it describes a treatment — "ground beef" is a distinct USDA record
// ("Beef, ground"), and stripping it resolved the line to corned beef.
const PREPARATION_WORDS = new Set([
  "chopped", "finely", "coarsely", "minced", "diced", "sliced", "grated", "shredded",
  "crushed", "peeled", "seeded", "trimmed", "cubed", "julienned", "quartered",
  "halved", "melted", "softened", "beaten", "packed", "sifted", "divided", "optional",
  "fresh", "freshly", "dried", "frozen", "canned", "cooked", "raw", "plus", "more",
  "taste", "needed", "room", "temperature", "large", "medium", "small", "thinly",
  "roughly", "lightly", "well", "drained", "rinsed", "warm", "cold", "hot",
  // Form words. "dried oregano leaves" is oregano; searched as written, the
  // head-noun retry fell back to "leaves" alone and returned taro leaves.
  "leaves", "leaf", "whole", "halves", "pieces", "sprigs", "sprig",
]);

/**
 * Reduce an ingredient phrase to the words that identify the food.
 *
 * Parentheticals go first: "salt (or to taste)", "chili sauce (see note)" and
 * "bread crumbs (or seasoned breadcrumbs)" all failed to match because the
 * aside was being searched as if it were part of the name.
 */
export function foodTerms(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")   // drop asides entirely
    .split(/,|;/)[0]!             // keep only the head phrase
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !PREPARATION_WORDS.has(t));
}
interface PortionRow {
  amount: number | null;
  unit: string | null;
  modifier: string | null;
  gram_weight: number;
}

/**
 * Find the USDA food that best matches an ingredient name.
 *
 * Foundation and SR Legacy are preferred over FNDDS survey foods: survey
 * records describe prepared dishes ("Beef, ground, patty"), and a recipe
 * ingredient is almost always the raw component.
 *
 * Shortest description wins among equally-ranked hits, because USDA's shortest
 * entries are the generic ones — "Onions, raw" rather than "Onions, raw, with
 * salt added, drained".
 */
export function matchFood(
  db: Database,
  name: string,
  /**
   * True when the caller needs a household measure, not just an identity.
   *
   * This flips the dataset preference, and the numbers say why: Foundation has
   * 469 foods but only 187 portions, while SR Legacy has 7,793 foods and 14,449.
   * Preferring Foundation gives the most precisely analysed record and then no
   * way to convert a cup of it — which is how "ketchup" resolved to "Ketchup,
   * restaurant" with zero portions while SR Legacy's "Catsup" had the cup.
   */
  needsPortion = false,
): FoodRow | null {
  const terms = foodTerms(name);
  if (terms.length === 0) return null;

  // The head noun is what the food IS: "unsalted butter" is a butter, "ground
  // beef chuck" is a beef. Records whose description opens with it are ranked
  // first, which is what separates "Milk, whole" from "Crackers, milk" — bm25
  // alone gives a single short term too little to discriminate on.
  const head = terms[terms.length - 1]!;

  // Ranking happens in a subquery: bm25() cannot be used alongside GROUP BY.
  const sql = (having: string) => `
    SELECT fdc_id, description FROM (
      SELECT f.fdc_id, f.description, f.dataset, bm25(foods_fts) AS rank,
             (SELECT COUNT(*) FROM portions p WHERE p.fdc_id = f.fdc_id) AS portions
      FROM foods_fts JOIN foods f ON f.fdc_id = foods_fts.rowid
      WHERE foods_fts MATCH ?1
      ORDER BY rank LIMIT 400
    ) ${having}
    ORDER BY ${needsPortion ? "CASE WHEN portions > 0 THEN 0 ELSE 1 END," : ""}
             CASE WHEN lower(description) LIKE ?2 THEN 0 ELSE 1 END,
             CASE dataset
               WHEN '${needsPortion ? "sr-legacy" : "foundation"}' THEN 0
               WHEN '${needsPortion ? "foundation" : "sr-legacy"}' THEN 1
               ELSE 2 END,
             rank,
             length(description) - length(replace(description, ',', '')),
             length(description)
    LIMIT 1`;

  const startsWith = `${head}%`;
  for (const query of [
    terms.map((t) => `"${t}"`).join(" "),  // all identifying words
    `"${head}"`,                            // head noun alone
  ]) {
    const hit =
      (needsPortion &&
        db.query<FoodRow, [string, string]>(sql("WHERE portions > 0")).get(query, startsWith)) ||
      db.query<FoodRow, [string, string]>(sql("")).get(query, startsWith);
    if (hit) return hit;
  }
  return null;
}

const SIZE_WORDS = ["large", "medium", "small", "jumbo"];

/**
 * Portions describing ONE WHOLE ITEM, for lines that count rather than measure:
 * "2 large eggs", "1 onion". USDA publishes these — an egg is 38, 44, 50, 56 or
 * 63 g by size, a medium onion 110 g — so counting is as grounded as weighing.
 *
 * Volumes, cuts and label servings are excluded: "1 cup, chopped" is a portion
 * of onion but not a whole onion.
 */
function wholeItemPortions(portions: PortionRow[]): PortionRow[] {
  return portions.filter((p) => {
    const text = `${p.unit ?? ""} ${p.modifier ?? ""}`.toLowerCase();
    if (/\b(cup|cups|tbsp|tsp|tablespoon|teaspoon|oz|fl|slice|chopped|sliced|diced|grated|mashed|nlea|serving|stalk|clove|sprig|ring|wedge)/.test(text)) {
      return false;
    }
    return /\b(extra large|large|medium|small|jumbo|whole|each|fruit|item)\b/.test(text) ||
      (p.unit !== null && p.unit !== "");
  });
}

/** Does a USDA portion row describe the unit we are trying to convert? */
function portionMatchesUnit(p: PortionRow, unit: string): boolean {
  const text = `${p.unit ?? ""} ${p.modifier ?? ""}`.toLowerCase();
  if (unit === "cup") return /\bcup\b/.test(text);
  if (unit === "tbsp") return /\btbsp\b|\btablespoon/.test(text);
  if (unit === "tsp") return /\btsp\b|\bteaspoon/.test(text);
  return new RegExp(`\\b${unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

export interface ToGramsOptions {
  quantity: number;
  unit: string;
  /** Ingredient name, already stripped of quantity and preparation words. */
  name: string;
  /**
   * Preparation or form, when the recipe states one — "chopped", "ground",
   * "minced". Used to choose between USDA portions of the same unit, which is
   * where the oregano 1.0 g / 1.8 g difference lives.
   */
  condition?: string | null;
  db: Database;
  /**
   * Our own mapping, consulted before the search heuristics.
   *
   * Omitted in tests that only exercise arithmetic; callers doing real work
   * pass one from readAliases().
   */
  aliases?: AliasTable;
}

export function toGrams(opts: ToGramsOptions): GramResult {
  const unit = normalizeUnit(opts.unit);
  const aliases = opts.aliases ?? EMPTY_TABLE;
  // A stated amount outranks a reject phrase; see resolveAlias.
  const quantified =
    Number.isFinite(opts.quantity) && opts.quantity > 0 && unit !== "to taste";
  const alias = resolveAlias(aliases, opts.name, quantified);

  /**
   * Our table first, heuristics second.
   *
   * A mapped fdc_id is looked up directly rather than searched for, so a
   * curated decision cannot be overturned by a ranking change.
   */
  const identify = (needsPortion: boolean): FoodRow | null => {
    if ((alias.kind === "exact" || alias.kind === "pattern") && alias.fdcId < 0) {
      const own = aliases.notInUsda.byId.get(alias.fdcId);
      if (own?.kind === "food" && rule(`gap:${own.key}`)) return { fdc_id: own.id, description: own.description };
    }
    if (alias.kind === "exact" || alias.kind === "pattern") {
      const row = opts.db
        ?.query<FoodRow, [number]>(`SELECT fdc_id, description FROM foods WHERE fdc_id = ?1`)
        .get(alias.fdcId);
      if (row) return row;
    }
    return opts.db ? matchFood(opts.db, opts.name, needsPortion) : null;
  };

  const empty: GramResult = {
    grams: null, basis: "unconvertible-unit", fdcId: null,
    foodDescription: null, portionUsed: null, note: null, workaround: null,
  };

  if (alias.kind === "reject") {
    return { ...empty, basis: "rejected-by-alias", note: `"${alias.matched}" is not a food` };
  }

  if (!Number.isFinite(opts.quantity) || opts.quantity <= 0) {
    return { ...empty, note: "no usable quantity" };
  }

  // 0. A form USDA lacks: counted as the dry record, by dry matter (G22).
  const form =
    (alias.kind === "exact" || alias.kind === "pattern") && alias.fdcId < 0
      ? aliases.notInUsda.byId.get(alias.fdcId)
      : undefined;
  if (form?.kind === "form" && rule(`gap:${form.key}`)) return countAsDry(opts, form, unit);

  // 1. Already a mass. The arithmetic needs no food, but the IDENTITY still
  //    does: comparison clusters ingredients by fdc_id, and returning null here
  //    made every mass-measured line — which is most of the meat in any recipe —
  //    invisible to clustering. Look the food up anyway, without needing a
  //    portion, and never let a failed lookup cost us the exact mass.
  const massFactor = MASS_GRAMS[unit];
  if (massFactor !== undefined) {
    // opts.db may legitimately be absent: a mass needs no lookup to be exact.
    const identified = identify(false);
    // A tenth of a gram is a fifth of a quarter-gram of nutmeg (G17).
    const per = rule("line:hundredth-gram") ? 100 : 10;
    return {
      grams: Math.round(opts.quantity * massFactor * per) / per,
      basis: "direct-mass",
      fdcId: identified?.fdc_id ?? null,
      foodDescription: identified?.description ?? null,
      portionUsed: null,
      note: identified ? null : "mass exact; food not identified",
      workaround: identified && identified.fdc_id < 0 ? NOT_IN_USDA_TAG : null,
    };
  }

  // 2. Everything else needs the food, because everything else needs a density.
  // needsPortion: everything past a plain mass requires a household measure.
  const food = identify(true);
  if (!food) return { ...empty, basis: "no-food-match", note: `no USDA match for "${opts.name}"` };

  // Our own food carries its own portions; a USDA one has them in usda.db.
  const own = food.fdc_id < 0 ? aliases.notInUsda.byId.get(food.fdc_id) : undefined;
  const portions: PortionRow[] =
    own?.kind === "food"
      ? own.portions.map((p) => ({ amount: p.amount, unit: null, modifier: p.unit, gram_weight: p.gramWeight }))
      : opts.db
          .query<PortionRow, [number]>(
            `SELECT amount, unit, modifier, gram_weight FROM portions WHERE fdc_id = ?1`,
          )
          .all(food.fdc_id);
  const ownBasis = own ? ({ basis: "not-in-usda", workaround: NOT_IN_USDA_TAG } as const) : null;

  const describe = (p: PortionRow) =>
    `${p.amount ?? 1} ${p.modifier ?? p.unit ?? ""} = ${p.gram_weight} g`.replace(/\s+/g, " ").trim();

  // A line that counts ("2 large eggs", "1 onion") wants a whole-item portion;
  // one that measures ("1 cup", "2 cloves") wants a portion in that unit.
  const isCount = unit === "each" || SIZE_WORDS.includes(unit);
  const candidates = isCount
    ? wholeItemPortions(portions)
    : portions.filter((p) => portionMatchesUnit(p, unit));

  if (candidates.length > 0) {
    const has = (p: PortionRow, word: string) =>
      `${p.unit ?? ""} ${p.modifier ?? ""}`.toLowerCase().includes(word);

    // In order: the size the recipe stated; the preparation it stated (this is
    // where "1 tsp, ground" and "1 tsp, leaves" part ways); then medium, which
    // is what an unqualified "1 onion" or "2 stalks celery" means in practice.
    const cond = opts.condition?.toLowerCase().trim();
    const bySize = SIZE_WORDS.includes(unit) ? candidates.find((p) => has(p, unit)) : undefined;
    // Several words may arrive ("ground dried"); any one can select a portion.
    const condWords = cond ? cond.split(/\s+/).filter(Boolean) : [];
    const byCondition = candidates.find((p) => condWords.some((w) => has(p, w)));
    const byMedium = candidates.length > 1 ? candidates.find((p) => has(p, "medium")) : undefined;
    const chosen = bySize ?? byCondition ?? byMedium ?? candidates[0]!;

    const per = chosen.gram_weight / (chosen.amount && chosen.amount > 0 ? chosen.amount : 1);
    return {
      grams: Math.round(opts.quantity * per * 10) / 10,
      basis: "usda-portion",
      workaround: null,
      ...ownBasis,
      fdcId: food.fdc_id,
      foodDescription: food.description,
      portionUsed: describe(chosen),
      note:
        !bySize && !byCondition && byMedium
          ? `size not stated; assumed medium of ${candidates.length} portions`
          : !byCondition && cond && candidates.length > 1
            ? `condition "${cond}" not matched; used "${chosen.modifier ?? chosen.unit}" of ${candidates.length} portions`
            : null,
    };
  }

  // 3. No portion in this unit — but if the food publishes another VOLUME
  //    measure, the ratio between the two volumes is exact, so scaling is
  //    arithmetic rather than a density guess.
  const thisMl = ML[unit];
  if (thisMl !== undefined) {
    for (const [otherUnit, otherMl] of Object.entries(ML)) {
      const alt = portions.find((p) => portionMatchesUnit(p, otherUnit));
      if (!alt) continue;
      const per = alt.gram_weight / (alt.amount && alt.amount > 0 ? alt.amount : 1);
      return {
        grams: Math.round(opts.quantity * per * (thisMl / otherMl) * 10) / 10,
        basis: "usda-portion-scaled",
        workaround: null,
        ...ownBasis,
        fdcId: food.fdc_id,
        foodDescription: food.description,
        portionUsed: describe(alt),
        note: `scaled from ${otherUnit} to ${unit} by volume`,
      };
    }
  }

  return {
    ...empty,
    basis: "no-portion-match",
    fdcId: food.fdc_id,
    foodDescription: food.description,
    note: `"${food.description}" publishes no ${unit} portion (${portions.length} portions available)`,
  };
}

const NOT_IN_USDA_TAG = "not in USDA";

/**
 * A fresh form counted as its dry record (G22). Only a stated mass converts: a
 * cup of fresh noodles has no density on record, and a guess would be the
 * confident wrong answer this module refuses to give.
 */
function countAsDry(opts: ToGramsOptions, form: OwnForm, unit: string): GramResult {
  const dry = opts.db
    ?.query<FoodRow, [number]>(`SELECT fdc_id, description FROM foods WHERE fdc_id = ?1`)
    .get(form.countAs);
  const refused = (note: string): GramResult => ({
    grams: null, basis: "no-portion-match", fdcId: dry?.fdc_id ?? null,
    foodDescription: dry?.description ?? null, portionUsed: null, note, workaround: null,
  });
  const massFactor = MASS_GRAMS[unit];
  if (massFactor === undefined) return refused(`${form.description} by ${unit}: only a stated mass converts to dry`);
  const wetWater = opts.db ? waterOf(opts.db, form.waterFrom) : null;
  const dryWater = opts.db ? waterOf(opts.db, form.countAs) : null;
  if (!dry || wetWater === null || dryWater === null) {
    return refused(`${form.description}: the USDA water figures needed are missing`);
  }
  const factor = dryFactor(wetWater, dryWater);
  const asStated = Math.round(opts.quantity * massFactor * 10) / 10;
  return {
    grams: Math.round(asStated * factor * 10) / 10,
    basis: "counted-as-dry",
    fdcId: dry.fdc_id,
    foodDescription: dry.description,
    portionUsed: null,
    note:
      `${form.description}: ${asStated} g as stated, counted as ${Math.round(asStated * factor)} g dry ` +
      `(×${factor.toFixed(2)}: ${wetWater}% water fresh, ${dryWater}% dry)`,
    workaround: `fresh, counted as dry ×${factor.toFixed(2)}`,
  };
}
