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

function parseQuantity(text: string): number {
  text = text.trim();
  
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

  // Handle ranges "2-3" -> take first
  if (text.includes("-")) {
    const start = text.split("-")[0].trim();
    return Number(start);
  }

  return Number(text);
}

export function parseIngredientLine(line: string): ParsedIngredient {
  const originalLine = line;
  line = line.trim().replace(/^∙/, "").trim(); // Remove leading bullets

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
    const altMatch = content.match(/^([\d\s\/\-½-⅞]+)\s*([a-zA-Z]+)/);
    if (altMatch) {
      alternateQuantity = {
        quantity: parseQuantity(altMatch[1]),
        unit: altMatch[2].toLowerCase(),
      };
      line = line.replace(parenMatch[0], "").replace(/\s\s+/g, ' ').trim();
    }
  }

  // Basic regex for "Quantity Unit Ingredient"
  const match = line.match(/^([\d\s\/\-½-⅞\."]+)\s*([a-zA-Z]+|(?:")|(?:"))?\s*(.*)$/);

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