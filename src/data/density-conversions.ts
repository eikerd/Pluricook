// Volume-to-mass conversion factors (grams per cup)
// Source: USDA Food Portions tables + manual research
// Format: { ingredientPattern: gramsPerCup }

export const DENSITY_DB: Record<string, number> = {
  // Flours & Starches
  "all-purpose flour": 125,
  "bread flour": 127,
  "cake flour": 114,
  "cornstarch": 128,
  "potato starch": 160,
  
  // Sugars
  "granulated sugar": 200,
  "brown sugar": 220,           // packed
  "powdered sugar": 120,
  
  // Liquids
  "water": 237,
  "milk": 244,
  "soy sauce": 255,
  "vegetable oil": 218,
  "sesame oil": 218,
  "mirin": 252,
  "rice vinegar": 239,
  "chicken stock": 240,
  "chinese cooking wine": 240,  // Shaoxing
  
  // Fats
  "butter": 227,
  "unsalted butter": 227,
  
  // Other common
  "ketchup": 240,
  "sambal oelek": 250,
  "sriracha": 250,
  
  // Add more as you encounter them
};

// Common unit conversions to cups
export const UNIT_TO_CUPS: Record<string, number> = {
  "cup": 1,
  "c": 1,
  "tablespoon": 1/16,
  "tbsp": 1/16,
  "T": 1/16,
  "teaspoon": 1/48,
  "tsp": 1/48,
  "t": 1/48,
  "fluid ounce": 1/8,
  "fl oz": 1/8,
  "ml": 1/236.588,
  "liter": 4.227,
  "L": 4.227,
};

// Direct weight conversions to grams
export const UNIT_TO_GRAMS: Record<string, number> = {
  "gram": 1,
  "g": 1,
  "kilogram": 1000,
  "kg": 1000,
  "ounce": 28.35,
  "oz": 28.35,
  "pound": 453.592,
  "lb": 453.592,
  "lbs": 453.592,
};
