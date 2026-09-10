import { DENSITY_DB, UNIT_TO_CUPS, UNIT_TO_GRAMS } from "../data/density-conversions";
import { ParsedIngredient } from "./ingredient-parser";

export function normalizeToGrams(parsed: ParsedIngredient): number {
  const { quantity, unit, ingredientName } = parsed;
  const unitLower = unit.toLowerCase();

  // 1. Check direct weight units (g, kg, oz, lb)
  if (UNIT_TO_GRAMS[unitLower]) {
    return quantity * UNIT_TO_GRAMS[unitLower];
  }

  // 2. Check volume units (cup, tbsp, tsp, ml)
  if (UNIT_TO_CUPS[unitLower]) {
    const cups = quantity * UNIT_TO_CUPS[unitLower];
    
    // Find density for the ingredient
    const normalizedName = ingredientName.toLowerCase();
    
    // Simple substring matching for density lookup
    let density = 237; // Default to water density (1g/ml approx)
    
    for (const [pattern, gramsPerCup] of Object.entries(DENSITY_DB)) {
      if (normalizedName.includes(pattern)) {
        density = gramsPerCup;
        break;
      }
    }
    
    return cups * density;
  }

  // 3. Fallback for "to taste" or "unit"
  // This is tricky. For "units" (like 2 cloves of garlic), we'd ideally have a per-unit weight.
  // For now, return 0 or a very small default if unknown.
  if (unitLower === "unit" || unitLower === "each" || unitLower === "clove") {
    // Some hardcoded defaults for common "unit" ingredients
    if (ingredientName.toLowerCase().includes("garlic")) return quantity * 5; // 5g per clove
    if (ingredientName.toLowerCase().includes("egg")) return quantity * 50; // 50g per egg
    if (ingredientName.toLowerCase().includes("ginger")) return quantity * 10; // rough estimate for a "knob"
  }

  return 0; // Unknown
}
