# Recipe Comparison & Analysis App - Implementation TODO

## Project Overview

Build a "Recipe Consensus & Cost Engine" that:
1. Normalizes ingredients against USDA databases (nutrition, density, quantity)
2. Compares multiple recipe versions from different authors for the same dish
3. Visualizes common ingredients, outliers, and nutritional data
4. Estimates cooking costs based on grocery pricing

**Tech Stack:** Bun + React + TypeScript (see CLAUDE.md for Bun conventions)

---

## Phase 1: Data Models & Types

### 1.1 Define Core TypeScript Interfaces

Create `src/types/recipe.ts`:

```typescript
// Raw ingredient as parsed from recipe text
interface RawIngredient {
  rawText: string;              // "2 tablespoons of unsalted butter"
  quantity: number;             // 2
  unit: string;                 // "tablespoon"
  ingredientName: string;       // "unsalted butter"
  preparation?: string;         // "chopped", "minced", etc.
}

// Normalized ingredient linked to USDA
interface NormalizedIngredient {
  raw: RawIngredient;
  normalizedName: string;       // "Butter, without salt"
  fdcId: number;                // USDA FoodData Central ID (e.g., 173410)
  weightGrams: number;          // Converted to grams
  nutrition: NutritionData;
  costEstimated?: number;       // In USD
}

// USDA Nutrition data
interface NutritionData {
  calories: number;
  protein: number;              // grams
  carbohydrates: number;        // grams
  fat: number;                  // grams
  fiber?: number;
  sodium?: number;              // mg
  sugar?: number;
  // Add more as needed from USDA data
}

// Recipe from a single author
interface Recipe {
  id: string;
  name: string;                 // "General Tso's Chicken"
  author: string;               // "Brian Lagerstrom"
  sourceUrl: string;            // YouTube/blog link
  sections: RecipeSection[];    // Grouped ingredients (marinade, sauce, etc.)
  totalNutrition: NutritionData;
  totalCost: number;
  servings?: number;
}

interface RecipeSection {
  name: string;                 // "Chicken and Marinade", "Sauce", etc.
  ingredients: NormalizedIngredient[];
}

// Comparison result across multiple recipes
interface RecipeComparison {
  dishName: string;
  recipes: Recipe[];
  consensus: ConsensusAnalysis;
}

interface ConsensusAnalysis {
  commonIngredients: CommonIngredient[];    // >80% of recipes
  outliers: OutlierIngredient[];            // Unique to 1-2 recipes
  averageRecipe: AverageIngredient[];       // Median quantities
  nutritionalVariance: NutritionalVariance;
}

interface CommonIngredient {
  normalizedName: string;
  fdcId: number;
  frequency: number;            // How many recipes include it
  quantities: { author: string; grams: number }[];
  medianGrams: number;
}

interface OutlierIngredient {
  normalizedName: string;
  fdcId: number;
  author: string;
  weightGrams: number;
  reason: string;               // "unique ingredient" or "unusual quantity"
}
```

### 1.2 Create Density Conversion Database

Create `src/data/density-conversions.ts`:

```typescript
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
```

---

## Phase 2: Ingredient Parser

### 2.1 Build the Parsing Engine

Create `src/lib/ingredient-parser.ts`:

**Requirements:**
- Extract quantity (handle fractions like "1/2", ranges like "2-3")
- Extract unit (handle abbreviations: T, t, c, lb, oz, g)
- Extract ingredient name
- Handle preparation words (chopped, minced, grated, etc.)
- Handle parenthetical alternatives: "potato starch (sub cornstarch)"

**Parsing Strategy:**
```
Input: "30g (2T) soy sauce"
Output: {
  quantity: 30,
  unit: "g",
  ingredientName: "soy sauce",
  alternateQuantity: { quantity: 2, unit: "T" }
}
```

**Edge Cases from general-tso.txt:**
- `∙450g (1lb, ~2 breasts) boneless skinless chicken breast`
- `1" (2.5cm) knob ginger, finely grated`
- `6-12 arbol chiles (optional)`
- `2 - 2.5 quarts (1.9-2.3L) vegetable oil`
- `Kosher salt, to taste`
- `MSG, to taste, optional`

### 2.2 Implement Unit Normalization

Create `src/lib/unit-normalizer.ts`:

- Convert all measurements to grams (metric default)
- Use density database for volume → mass conversions
- Store original measurement for display: `{ grams: 30, original: "2T" }`

---

## Phase 3: USDA Database Integration

### 3.1 Download & Process USDA Data

**Data Sources:**
- USDA FoodData Central: https://fdc.nal.usda.gov/download-datasets
- Download "Foundation Foods" and "SR Legacy" datasets (JSON format)

Create `src/data/usda/` directory structure:
```
src/data/usda/
  ├── foundation-foods.json
  ├── sr-legacy.json
  └── index.ts          # Loader and search functions
```

### 3.2 Build USDA Lookup Service

Create `src/lib/usda-service.ts`:

```typescript
interface USDAFood {
  fdcId: number;
  description: string;
  foodNutrients: USDANutrient[];
  foodPortions?: USDAFoodPortion[];  // For density data
}

interface USDAFoodPortion {
  measureUnit: { name: string };
  gramWeight: number;
}

// Functions needed:
// - searchFoods(query: string): USDAFood[]
// - getFoodById(fdcId: number): USDAFood
// - getNutrition(fdcId: number, grams: number): NutritionData
// - getDensity(fdcId: number, unit: string): number | null
```

### 3.3 Ingredient Matching/Linking

Create `src/lib/ingredient-matcher.ts`:

- Fuzzy match ingredient names to USDA entries
- Handle synonyms: "Shaoxing wine" → "Chinese cooking wine"
- Cache successful matches for performance
- Allow manual overrides for edge cases

---

## Phase 4: Recipe Comparison Engine

### 4.1 Build Comparison Logic

Create `src/lib/recipe-analyzer.ts`:

```typescript
class RecipeAnalyzer {
  // Find ingredients appearing in >80% of recipes
  findCommonIngredients(recipes: Recipe[]): CommonIngredient[];
  
  // Find unique additions or unusual quantities
  findOutliers(recipes: Recipe[]): OutlierIngredient[];
  
  // Calculate median quantities for common ingredients
  calculateAverageRecipe(recipes: Recipe[]): AverageIngredient[];
  
  // Statistical analysis of nutritional differences
  analyzeNutritionalVariance(recipes: Recipe[]): NutritionalVariance;
  
  // Full comparison
  compareRecipes(recipes: Recipe[]): RecipeComparison;
}
```

### 4.2 Implement Clustering Algorithm

For ingredient clustering (detecting same ingredient across recipes):
- Normalize ingredient names (lowercase, remove preparation words)
- Match by USDA fdcId when available
- Fuzzy string matching as fallback
- Consider ingredients "same" if similarity > 0.85

---

## Phase 5: Cost Estimation

### 5.1 Create Price Database

Create `src/data/grocery-prices.ts`:

```typescript
// Local price database (update manually or via API later)
// Prices in USD per standard unit
export const PRICE_DB: Record<string, PriceEntry> = {
  "chicken thigh": { pricePerGram: 0.0088, unit: "lb", pricePerUnit: 3.99 },
  "chicken breast": { pricePerGram: 0.0099, unit: "lb", pricePerUnit: 4.49 },
  "soy sauce": { pricePerGram: 0.008, unit: "bottle", pricePerUnit: 3.99 },
  "all-purpose flour": { pricePerGram: 0.0013, unit: "5lb bag", pricePerUnit: 2.99 },
  // ... etc
};
```

### 5.2 Future: Grocery API Integration

Consider APIs for real-time pricing:
- Kroger API
- Target API  
- Spoonacular API
- Instacart (unofficial)

---

## Phase 6: API Endpoints

### 6.1 Update `src/index.ts` with New Routes

```typescript
// POST /api/recipes/parse
// Body: { text: string }
// Returns: Recipe (parsed and normalized)

// POST /api/recipes/compare
// Body: { recipes: Recipe[] }
// Returns: RecipeComparison

// GET /api/usda/search?q={query}
// Returns: USDAFood[]

// GET /api/usda/food/:fdcId
// Returns: USDAFood with full nutrition

// GET /api/ingredients/density?ingredient={name}&unit={unit}
// Returns: { grams: number }

// GET /api/ingredients/price?ingredient={name}&grams={amount}
// Returns: { cost: number, priceSource: string }
```

---

## Phase 7: Frontend Visualization

### 7.1 Install Visualization Libraries

```bash
bun add recharts d3 @visx/visx
```

### 7.2 Create Visualization Components

Create `src/components/visualizations/`:

#### RadarChart.tsx - Nutritional Comparison
- Compare protein/carbs/fats across recipes
- One polygon per author
- Interactive hover for exact values

#### SankeyDiagram.tsx - Cost Flow
- Show which ingredients drive total cost
- Flow from ingredients → categories → total
- Color code by expense level

#### ClusterHeatmap.tsx - Ingredient Matrix
- Rows: Ingredients
- Columns: Authors/Recipes
- Cell color: Quantity (darker = more)
- Highlight outliers

#### ParallelCoordinates.tsx - Multi-Dimensional
- Axes: Calories, Cost, Prep Time, Servings, etc.
- Lines: One per recipe
- Interactive brushing to filter

#### IngredientComparisonBar.tsx - Simple Bar Chart
- Side-by-side bars for same ingredient across recipes
- Good for quick quantity comparison

### 7.3 Main App Layout

Update `src/App.tsx`:

```
┌─────────────────────────────────────────────────────┐
│  Recipe Comparison App                              │
├─────────────────────────────────────────────────────┤
│  [Paste Recipe 1] [Paste Recipe 2] [Paste Recipe 3] │
│  [Parse & Compare Button]                           │
├─────────────────────────────────────────────────────┤
│  Tab: Overview | Ingredients | Nutrition | Cost     │
├─────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────────────────────┐   │
│  │ Recipe List │  │  Active Visualization       │   │
│  │ - Author 1  │  │  (changes based on tab)     │   │
│  │ - Author 2  │  │                             │   │
│  │ - Author 3  │  │                             │   │
│  └─────────────┘  └─────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  Common Ingredients    │    Outliers/Unique        │
│  ☑ Chicken thighs      │    ⚠ Vodka (Babish)       │
│  ☑ Soy sauce           │    ⚠ Ketchup (Lagerstrom) │
│  ☑ Cornstarch          │    ⚠ Shirodashi (Weissman)│
└─────────────────────────────────────────────────────┘
```

---

## Phase 8: Data Entry & Storage

### 8.1 Recipe Input Component

Create `src/components/RecipeInput.tsx`:
- Textarea for pasting raw recipe text
- Author name and source URL fields
- "Parse Recipe" button
- Preview of parsed ingredients before confirming

### 8.2 Local Storage / SQLite

For persistence, use Bun's built-in SQLite:

```typescript
import { Database } from "bun:sqlite";

const db = new Database("recipes.db");

// Tables:
// - recipes (id, name, author, sourceUrl, createdAt)
// - recipe_sections (id, recipeId, name, order)
// - ingredients (id, sectionId, rawText, normalizedName, fdcId, weightGrams, cost)
// - usda_cache (fdcId, data, cachedAt)
// - price_cache (ingredient, price, source, cachedAt)
```

---

## Phase 9: Testing

### 9.1 Unit Tests

Create `src/__tests__/`:

```typescript
// ingredient-parser.test.ts
// - Test fraction parsing: "1/2", "1 1/2", "½"
// - Test unit normalization
// - Test edge cases from general-tso.txt

// unit-normalizer.test.ts
// - Test volume to mass conversions
// - Test density lookups

// recipe-analyzer.test.ts
// - Test common ingredient detection
// - Test outlier detection
// - Test average recipe calculation
```

### 9.2 Integration Tests

```typescript
// Parse all three General Tso recipes
// Compare them
// Verify expected common ingredients (chicken, soy sauce, cornstarch)
// Verify expected outliers (vodka, ketchup, shirodashi)
```

---

## Implementation Order (Recommended)

### Sprint 1: Foundation
- [ ] 1.1 Define TypeScript interfaces
- [ ] 1.2 Create density conversion database
- [ ] 2.1 Build ingredient parser (basic)
- [ ] 2.2 Implement unit normalizer

### Sprint 2: USDA Integration
- [ ] 3.1 Download USDA data
- [ ] 3.2 Build USDA lookup service
- [ ] 3.3 Implement ingredient matching

### Sprint 3: Analysis Engine
- [ ] 4.1 Build comparison logic
- [ ] 4.2 Implement clustering
- [ ] 5.1 Create price database

### Sprint 4: API & Frontend
- [ ] 6.1 Create API endpoints
- [ ] 7.1 Install visualization libraries
- [ ] 7.2 Create visualization components
- [ ] 7.3 Build main app layout

### Sprint 5: Polish
- [ ] 8.1 Recipe input component
- [ ] 8.2 SQLite persistence
- [ ] 9.1 Unit tests
- [ ] 9.2 Integration tests

---

## Test Data

Use the three recipes in `general-tso.txt` as your primary test data:
1. **Brian Lagerstrom** - Uses grams primarily, includes ketchup and MSG
2. **Babish** - Uses imperial, includes vodka and egg whites
3. **Joshua Weissman** - Mix of both, includes Sichuan chili flakes and shirodashi

**Expected Common Ingredients:**
- Chicken (thighs or breast)
- Soy sauce
- Cornstarch
- Ginger
- Garlic
- Sugar
- Rice vinegar or similar acid
- Cooking wine (Shaoxing/mirin)
- Dried chilies

**Expected Outliers:**
- Vodka (Babish only)
- Ketchup (Lagerstrom only)
- Shirodashi (Weissman only)
- Egg whites (Babish only)
- Baking powder amounts vary significantly

---

## Notes & Gotchas

1. **Density varies by preparation**: A cup of "flour, sifted" weighs less than "flour, spooned"
2. **MSG is optional** in most recipes - handle "to taste" and "optional" modifiers
3. **Chicken cut matters**: Thighs vs breasts have different nutrition profiles
4. **Same ingredient, different names**: Shaoxing wine = Chinese cooking wine = rice wine
5. **Metric is source of truth**: Always convert to grams, store original for display
6. **USDA data is huge**: Consider loading only needed portions, not entire dataset
7. **Price data gets stale**: Add `cachedAt` timestamps, refresh periodically

---

## Future Enhancements

- [ ] OCR for recipe images/screenshots
- [ ] Voice input for recipe dictation
- [ ] Recipe scaling (adjust servings)
- [ ] Shopping list generation
- [ ] Nutritional goals comparison (diet tracking)
- [ ] Recipe recommendation based on ingredients on hand
- [ ] Export to various formats (PDF, print-friendly)
- [ ] Collaborative recipe collections
- [ ] Real-time grocery price API integration
