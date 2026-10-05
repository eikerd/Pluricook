/**
 * Parse one ingredient line, repairing the unit the raw parser hands back.
 *
 * The underlying parser treats whatever token follows the number as the unit,
 * so "2 garlic cloves" yields unit "garlic" and "1 yellow onion" yields unit
 * "yellow". Every such line then failed conversion for want of a "garlic"
 * portion — and these are the commonest lines in cooking: eggs, onions, garlic,
 * celery. The worklist ranked them first, above every alias miss.
 *
 * The repair is done here, at the boundary, rather than inside the parser:
 * it is a small pure function that can be tested on its own, and the parser
 * has outstanding type errors queued for separate work.
 */

import { parseIngredientLine } from "./ingredient-parser";
import { rule } from "./rules";

/** Units we can reason about. Anything else after the number is part of the name. */
const MASS = ["g", "gram", "grams", "gm", "kg", "kilogram", "kilograms", "mg", "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds"];
const VOLUME = [
  "c", "cup", "cups", "tbsp", "tbs", "tb", "tablespoon", "tablespoons", "t", "tsp",
  "teaspoon", "teaspoons", "ml", "milliliter", "milliliters", "millilitre", "l", "liter",
  "liters", "litre", "pt", "pint", "pints", "qt", "quart", "quarts", "fl", "gallon", "gallons",
];
const SIZES = ["large", "medium", "small", "jumbo"];

/**
 * Nouns a recipe counts by. Kept singular; `singular()` folds the plurals in.
 * Each corresponds to a household portion USDA actually publishes — "1 clove",
 * "1 stalk, medium", "1 slice" — which is what makes counting convertible.
 */
export const COUNT_NOUNS = [
  "clove", "stalk", "sprig", "leaf", "head", "slice", "stick", "can", "bunch",
  "ear", "rib", "piece", "fillet", "strip", "cube", "packet", "package", "envelope",
];

const KNOWN = new Set([...MASS, ...VOLUME, ...SIZES, ...COUNT_NOUNS]);

/**
 * "-ves" is irregular, so it is a lookup rather than a rule. A blanket
 * "ves → f" is right for leaves and turns cloves into "clof", which then
 * matched no count noun and sent every garlic line back to the clove spice.
 */
const IRREGULAR: Record<string, string> = {
  leaves: "leaf", halves: "half", loaves: "loaf", knives: "knife",
};

export function singular(word: string): string {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/**
 * Words that change how much of a food fits in a measure.
 *
 * These select between USDA portions of the same unit: a cup of chopped onion
 * is 160 g and a cup of sliced is 115 g; a teaspoon of oregano is 1.0 g as
 * leaves and 1.8 g ground.
 */
const CONDITION_WORDS = [
  "chopped", "sliced", "diced", "minced", "grated", "shredded", "ground", "crushed",
  "mashed", "packed", "sifted", "crumbled", "melted", "whole", "leaves", "halves",
  "pieces", "cubed", "pureed", "cooked", "raw",
];

/**
 * Pull the preparation out of an ingredient phrase.
 *
 * The raw parser declares a `preparation` field and never sets it, so every
 * production caller was passing no condition at all and the oregano distinction
 * this project is built around was silently bypassed everywhere except in the
 * test that set the condition by hand.
 */
export function extractPreparation(phrase: string): string | null {
  const words = phrase.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/);
  const found = CONDITION_WORDS.filter((w) => words.includes(w));
  return found.length > 0 ? found.join(" ") : null;
}

export interface ParsedLine {
  quantity: number;
  /** A mass or volume unit, a size, a count noun, or "each". */
  unit: string;
  /** What the food is, with the unit and the count noun taken out. */
  name: string;
  preparation: string | null;
  /**
   * The mass the line states beside its measure — "3 cups (360g)" — in grams.
   * The recipe's own weighing, and so the best figure the line has.
   */
  statedGrams: number | null;
  rawLine: string;
}

/**
 * Metric masses only. "(8 oz)" is as often fluid ounces as weight, so an
 * ounce in brackets is left to the measure beside it rather than trusted.
 */
const STATED_MASS: Record<string, number> = {
  g: 1, gm: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000,
};

function statedGramsOf(alt: { quantity: number; unit: string } | undefined): number | null {
  const factor = alt ? STATED_MASS[alt.unit.toLowerCase()] : undefined;
  if (!alt || factor === undefined || !Number.isFinite(alt.quantity) || alt.quantity <= 0) return null;
  return Math.round(alt.quantity * factor * 1000) / 1000;
}

/**
 * What to convert: the stated mass when the line has one, its own measure
 * otherwise. Every caller of toGrams goes through here, so the pipeline and
 * the scripts that report on it cannot disagree (docs/recipe-gotchas.md G11).
 */
export function conversionInput(p: ParsedLine): { quantity: number; unit: string } {
  return p.statedGrams !== null && rule("line:stated-grams")
    ? { quantity: p.statedGrams, unit: "g" }
    : { quantity: p.quantity, unit: p.unit };
}

export function parseLine(rawLine: string): ParsedLine {
  const p = parseIngredientLine(rawLine);
  let unit = (p.unit ?? "").trim();
  // "1 tbsp. soy sauce" and "2 qt. broth" leave the abbreviation's dot on the
  // name. Fuzzy matching shrugs it off, which is how it hid: an EXACT alias for
  // "soy sauce" can never match ". soy sauce", so the alias silently did nothing.
  let name = (p.ingredientName ?? "").trim();
  let lead = "";
  if (/^[\s.,;:/–-]/.test(name) && rule("line:leading-punctuation")) {
    lead = /^[\s.,;:/–-]+/.exec(name)![0];
    name = name.slice(lead.length);
  }

  // 0. The raw parser returns "to taste" as its DEFAULT when it finds no unit,
  //    so "1 onion" came back as unit "to taste" and was then rejected as not a
  //    food. A line that opens with a number has a quantity; it is a count.
  const opensWithNumber = /^\s*[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(rawLine);
  if (unit.toLowerCase() === "to taste" && opensWithNumber && rule("line:number-is-a-count")) unit = "";

  // 1. A "unit" we do not recognise is really the first word of the name.
  const unitKey = singular(unit);
  if (unit.toLowerCase() === "to taste") {
    // Genuinely unquantified. Left as-is so conversion refuses it.
  } else if (unit !== "" && !KNOWN.has(unit.toLowerCase()) && !KNOWN.has(unitKey) && rule("line:unknown-unit-is-name")) {
    // "2 onions, chopped": the comma the parser left after "onions" belongs
    // between the food and its preparation, not nowhere (G27).
    const comma = /[,;]/.test(lead) && rule("line:comma-after-food") ? "," : "";
    name = `${unit}${comma} ${name}`.trim();
    unit = "each";
  } else if (unit === "") {
    unit = "each";
  } else if (COUNT_NOUNS.includes(unitKey) && rule("line:count-noun-singular")) {
    unit = unitKey;   // "cloves" → "clove", "stalks" → "stalk"
  }

  // 2. A counted line often carries its count noun inside the name:
  //    "garlic cloves, minced" is cloves of garlic, not a food called that.
  if (unit === "each" || SIZES.includes(unit.toLowerCase())) {
    // Brackets are blanked to the same length, so offsets into `head` are
    // offsets into `name` too; a shorter stand-in once cut the name mid-word (G28).
    const head = name.replace(/\([^)]*\)/g, (m) => " ".repeat(m.length)).split(/,|;/)[0]!;
    const words = head.trim().split(/\s+/);
    const at = words.findIndex((w) => COUNT_NOUNS.includes(singular(w)));
    // Only when another word remains — "bay leaf" minus "leaf" still names a food,
    // but a bare "cloves" is the spice and must be left alone.
    if (at !== -1 && words.length > 1 && rule("line:count-noun-from-name")) {
      unit = singular(words[at]!);
      const noun = new RegExp(`(^|\\s)${words[at]}(?=\\s|$)`);
      const kept = name.slice(0, head.length).replace(noun, "$1").replace(/\s\s+/g, " ").trim();
      name = `${kept}${name.slice(head.length)}`.trim();
    }
  }

  return {
    quantity: p.quantity,
    unit,
    name,
    // From the whole line, since the word may sit before the food ("ground
    // oregano"), after a comma ("onion, chopped") or in brackets.
    preparation: p.preparation ?? extractPreparation(rawLine),
    statedGrams: statedGramsOf(p.alternateQuantity),
    rawLine,
  };
}
