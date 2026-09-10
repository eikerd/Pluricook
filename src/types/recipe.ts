export interface RawIngredient {
  rawText: string;              // "2 tablespoons of unsalted butter"
  quantity: number;             // 2
  unit: string;                 // "tablespoon"
  ingredientName: string;       // "unsalted butter"
  preparation?: string;         // "chopped", "minced", etc.
}

export interface NormalizedIngredient {
  raw: RawIngredient;
  normalizedName: string;       // "Butter, without salt"
  fdcId: number;                // USDA FoodData Central ID (e.g., 173410)
  weightGrams: number;          // Converted to grams
  nutrition: NutritionData;
  costEstimated?: number;       // In USD
}

export interface NutritionData {
  calories: number;
  protein: number;              // grams
  carbohydrates: number;        // grams
  fat: number;                  // grams
  fiber?: number;
  sodium?: number;              // mg
  sugar?: number;
  // Add more as needed from USDA data
}

export interface Recipe {
  id: string;
  name: string;                 // "General Tso's Chicken"
  author: string;               // "Brian Lagerstrom"
  sourceUrl: string;            // YouTube/blog link
  sections: RecipeSection[];    // Grouped ingredients (marinade, sauce, etc.)
  totalNutrition: NutritionData;
  totalCost: number;
  servings?: number;
}

export interface RecipeSection {
  name: string;                 // "Chicken and Marinade", "Sauce", etc.
  ingredients: NormalizedIngredient[];
}

export interface RecipeComparison {
  dishName: string;
  recipes: Recipe[];
  consensus: ConsensusAnalysis;
}

export interface ConsensusAnalysis {
  commonIngredients: CommonIngredient[];    // >80% of recipes
  outliers: OutlierIngredient[];            // Unique to 1-2 recipes
  averageRecipe: AverageIngredient[];       // Median quantities
  nutritionalVariance: NutritionalVariance;
}

export interface CommonIngredient {
  normalizedName: string;
  fdcId: number;
  frequency: number;            // How many recipes include it
  quantities: { author: string; grams: number }[];
  medianGrams: number;
}

export interface OutlierIngredient {
  normalizedName: string;
  fdcId: number;
  author: string;
  weightGrams: number;
  reason: string;               // "unique ingredient" or "unusual quantity"
}

export interface AverageIngredient {
  normalizedName: string;
  fdcId: number;
  medianGrams: number;
}

export interface NutritionalVariance {
  // To be defined based on statistical needs
  [key: string]: any;
}
