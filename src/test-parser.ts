import { parseIngredientLine } from "./lib/ingredient-parser";
import { normalizeToGrams } from "./lib/unit-normalizer";

const testLines = [
  "∙450g (1lb, ~2 breasts) boneless skinless chicken breast",
  "1\" (2.5cm) knob ginger, finely grated",
  "6-12 arbol chiles (optional)",
  "2 - 2.5 quarts (1.9-2.3L) vegetable oil",
  "Kosher salt, to taste",
  "MSG, to taste, optional",
  "30g (2T) soy sauce",
  "1 cup all-purpose flour"
];

console.log("Testing Ingredient Parser & Normalizer:\n");

for (const line of testLines) {
  const parsed = parseIngredientLine(line);
  const grams = normalizeToGrams(parsed);
  console.log(`Input: "${line}"`);
  console.log(`Parsed:`, parsed);
  console.log(`Normalized: ${grams.toFixed(1)}g`);
  console.log("---\n");
}