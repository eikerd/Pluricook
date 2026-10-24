import { RawIngredient } from "../types/recipe";
import { rule } from "./rules";

export interface ParsedIngredient extends RawIngredient {
  alternateQuantity?: {
    quantity: number;
    unit: string;
  };
  isOptional?: boolean;
}

const FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "⅓": 0.333,
  "⅔": 0.666,
  "¼": 0.25,
  "¾": 0.75,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 0.166,
  "⅚": 0.833,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

/**
 * The vulgar fractions, named one by one. This was once written as the range
 * `½-⅞`, which is not a list of fractions but every code point from U+00BD to
 * U+215E: bullets, en dashes, curly quotes, accented letters, Greek and
 * Cyrillic — and not ¼, which sits at U+00BC. See docs/recipe-gotchas.md G6, G7.
 */
const VULGAR = "¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞";

/** A paste or PDF opens each line with its own bullet; JSON-LD lines have none. */
const LEADING_BULLET = /^(?:[•∙·▪◦‣*]|-(?=\s))\s*/;

/** "30g (2T)", "3 cups (0.25 g)": the amount inside brackets, decimals included. */
const BRACKETED_AMOUNT = new RegExp(`^([\\d\\s\\/\\-–.${VULGAR}]+)\\s*([a-zA-Z]+)`);

/** "(about 2 1/2 tsp)", "(approx. 120g)": a hedge before a bracketed amount. See G24. */
const BRACKETED_HEDGE = /^(?:about|approx\.?|approximately|roughly|around|~)\s*/i;

/** "20 g (1) ancho chile": a bare count in brackets beside a mass. See G24. */
const BRACKETED_COUNT = new RegExp(`^\\s*[\\d${VULGAR}][\\d\\s\\/.${VULGAR}]*$`);

/** "Quantity Unit Ingredient". */
const QUANTITY_UNIT_NAME = new RegExp(`^([\\d\\s\\/\\-–${VULGAR}\\."]+)\\s*([a-zA-Z]+|")?\\s*(.*)$`);

/**
 * "2 cups / 400g dried lentils", "1 kg / 2 lb ground beef": the same amount in a
 * second system, after a slash. Only a measure counts — "/ 2 large eggs" is not
 * one — and longer units come first so "grams" is not read as "g". See G18.
 */
const SLASH_ALTERNATE = new RegExp(
  `^\\/\\s*([\\d${VULGAR}][\\d\\s.${VULGAR}]*?)\\s*` +
    `(kilograms?|grams?|kg|gm|g|pounds?|lbs?|ounces?|oz|millilit(?:er|re)s?|ml|lit(?:er|re)s?|l|cups?|tablespoons?|tbsp|teaspoons?|tsp)` +
    `\\b\\.?\\s*(.*)$`,
  "i",
);

/**
 * "¾ cup 177 ml chicken stock", "¼ cup 25 g Parmesan": a recipe card's metric
 * conversion printed straight after the measure, with no slash or bracket.
 * Metric only, so "1 cup 2 large eggs" can never be read as one. See G32.
 */
const BARE_ALTERNATE = /^(\d+(?:\.\d+)?)\s*(grams?|gm|g|kg|millilit(?:er|re)s?|ml)\b\.?\s+(.*)$/i;

function parseQuantity(text: string): number {
  text = text.trim();

  // "2-3" or "2–3": a range reads as its first figure.
  const range = text.split(/\s*[-–]\s*/);
  if (range.length > 1 && range[0] !== "" && rule("parse:range-first-figure")) return parseQuantity(range[0]!);

  // Handle fractions like "1/2" or "1 1/2"
  if (text.includes("/")) {
    const parts = text.split(/\s+/);
    let total = 0;
    for (const part of parts) {
      if (part.includes("/")) {
        const [num, den] = part.split("/").map(Number);
        if (den !== 0) total += num / den;
      } else {
        total += Number(part);
      }
    }
    return total;
  }

  // Handle unicode fractions
  for (const [char, val] of Object.entries(FRACTIONS)) {
    if (text.includes(char) && rule("parse:unicode-fraction")) {
      const remaining = text.replace(char, "").trim();
      return (remaining ? Number(remaining) : 0) + val;
    }
  }

  return Number(text);
}

export function parseIngredientLine(line: string): ParsedIngredient {
  const originalLine = line;
  line = line.trim();
  if (LEADING_BULLET.test(line) && rule("parse:leading-bullet")) line = line.replace(LEADING_BULLET, "").trim();

  let isOptional = false;
  if (line.toLowerCase().includes("(optional)") && rule("parse:optional-mark")) {
    isOptional = true;
    line = line.replace(/\(optional\)/i, "").trim();
  }

  // Handle parenthetical alternatives like "30g (2T)"
  let alternateQuantity;
  const parenMatch = line.match(/\(([^)]+)\)/);
  if (parenMatch) {
    let content = parenMatch[1] ?? "";
    const hedged = BRACKETED_HEDGE.test(content) && BRACKETED_AMOUNT.test(content.replace(BRACKETED_HEDGE, ""));
    if (hedged && rule("parse:bracketed-hedge")) content = content.replace(BRACKETED_HEDGE, "");
    const altMatch = content.match(BRACKETED_AMOUNT);
    if (altMatch && rule("parse:bracketed-alternate")) {
      alternateQuantity = {
        quantity: parseQuantity(altMatch[1]),
        unit: altMatch[2].toLowerCase(),
      };
      line = line.replace(parenMatch[0], "").replace(/\s\s+/g, ' ').trim();
    } else if (BRACKETED_COUNT.test(content) && rule("parse:bracketed-count")) {
      // The count is a cross-check on the mass beside it, not a measure of its own.
      alternateQuantity = { quantity: parseQuantity(content), unit: "each" };
      line = line.replace(parenMatch[0], "").replace(/\s\s+/g, ' ').trim();
    }
  }

  // Basic regex for "Quantity Unit Ingredient"
  const match = line.match(QUANTITY_UNIT_NAME);

  if (!match) {
    return {
      rawText: originalLine,
      quantity: 0,
      unit: "to taste",
      ingredientName: line,
      isOptional,
    };
  }

  const quantityStr = match[1].trim();
  let unit = match[2]?.trim().toLowerCase() || "";
  let name = match[3]?.trim() || "";

  if (quantityStr.endsWith('"') && rule("parse:inch-mark")) {
    unit = "inch";
  } else if (quantityStr.endsWith("'") && rule("parse:inch-mark")) {
    unit = "foot";
  }

  const quantity = parseQuantity(quantityStr);

  // A second system's measure after a slash is an alternate, as a bracketed one
  // is: it leaves the name, and a metric mass becomes the line's stated grams.
  const slash = alternateQuantity ? null : SLASH_ALTERNATE.exec(name);
  if (slash && rule("parse:slash-alternate")) {
    alternateQuantity = { quantity: parseQuantity(slash[1]!), unit: slash[2]!.toLowerCase() };
    name = slash[3]!.trim();
  }

  const bare = alternateQuantity || !unit ? null : BARE_ALTERNATE.exec(name);
  if (bare && rule("parse:bare-alternate")) {
    alternateQuantity = { quantity: Number(bare[1]), unit: bare[2]!.toLowerCase() };
    name = bare[3]!.trim();
  }

  if (!name && unit) {
    name = unit;
    unit = "to taste";
  }

  return {
    rawText: originalLine,
    quantity,
    unit: unit || "unit",
    ingredientName: name,
    isOptional,
    alternateQuantity,
  };
}