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

export interface ParsedLine {
  quantity: number;
  /** A mass or volume unit, a size, a count noun, or "each". */
  unit: string;
  /** What the food is, with the unit and the count noun taken out. */
  name: string;
  preparation: string | null;
  rawLine: string;
}

export function parseLine(rawLine: string): ParsedLine {
  const p = parseIngredientLine(rawLine);
  let unit = (p.unit ?? "").trim();
  let name = (p.ingredientName ?? "").trim();

  // 0. The raw parser returns "to taste" as its DEFAULT when it finds no unit,
  //    so "1 onion" came back as unit "to taste" and was then rejected as not a
  //    food. A line that opens with a number has a quantity; it is a count.
  const opensWithNumber = /^\s*[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(rawLine);
  if (unit.toLowerCase() === "to taste" && opensWithNumber) unit = "";

  // 1. A "unit" we do not recognise is really the first word of the name.
  const unitKey = singular(unit);
  if (unit.toLowerCase() === "to taste") {
    // Genuinely unquantified. Left as-is so conversion refuses it.
  } else if (unit !== "" && !KNOWN.has(unit.toLowerCase()) && !KNOWN.has(unitKey)) {
    name = `${unit} ${name}`.trim();
    unit = "each";
  } else if (unit === "") {
    unit = "each";
  } else if (COUNT_NOUNS.includes(unitKey)) {
    unit = unitKey;   // "cloves" → "clove", "stalks" → "stalk"
  }

  // 2. A counted line often carries its count noun inside the name:
  //    "garlic cloves, minced" is cloves of garlic, not a food called that.
  if (unit === "each" || SIZES.includes(unit.toLowerCase())) {
    const head = name.replace(/\([^)]*\)/g, " ").split(/,|;/)[0]!;
    const words = head.trim().split(/\s+/);
    const at = words.findIndex((w) => COUNT_NOUNS.includes(singular(w)));
    // Only when another word remains — "bay leaf" minus "leaf" still names a food,
    // but a bare "cloves" is the spice and must be left alone.
    if (at !== -1 && words.length > 1) {
      unit = singular(words[at]!);
      words.splice(at, 1);
      name = `${words.join(" ")}${name.slice(head.length)}`.trim();
    }
  }

  return {
    quantity: p.quantity,
    unit,
    name,
    preparation: p.preparation ?? null,
    rawLine,
  };
}
