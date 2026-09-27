import { RawIngredient } from "../types/recipe";

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

/** "Quantity Unit Ingredient". */
const QUANTITY_UNIT_NAME = new RegExp(`^([\\d\\s\\/\\-–${VULGAR}\\."]+)\\s*([a-zA-Z]+|")?\\s*(.*)$`);

function parseQuantity(text: string): number {
  text = text.trim();

  // "2-3" or "2–3": a range reads as its first figure.
  const range = text.split(/\s*[-–]\s*/);
  if (range.length > 1 && range[0] !== "") return parseQuantity(range[0]!);

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
    if (text.includes(char)) {
      const remaining = text.replace(char, "").trim();
      return (remaining ? Number(remaining) : 0) + val;
    }
  }

  return Number(text);
}

export function parseIngredientLine(line: string): ParsedIngredient {
  const originalLine = line;
  line = line.trim().replace(LEADING_BULLET, "").trim();

  let isOptional = false;
  if (line.toLowerCase().includes("(optional)")) {
    isOptional = true;
    line = line.replace(/\(optional\)/i, "").trim();
  }

  // Handle parenthetical alternatives like "30g (2T)"
  let alternateQuantity;
  const parenMatch = line.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const content = parenMatch[1];
    const altMatch = content.match(BRACKETED_AMOUNT);
    if (altMatch) {
      alternateQuantity = {
        quantity: parseQuantity(altMatch[1]),
        unit: altMatch[2].toLowerCase(),
      };
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

  if (quantityStr.endsWith('"')) {
    unit = "inch";
  } else if (quantityStr.endsWith("'")) {
    unit = "foot";
  }

  const quantity = parseQuantity(quantityStr);

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