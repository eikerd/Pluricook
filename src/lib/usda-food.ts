/**
 * One USDA food, whole: every field of its record, its category named and
 * classed, and all of its portions and nutrients — what the admin's food page
 * at /usda/<fdc id> shows.
 */

import type { Database } from "bun:sqlite";
import { categoryOf, type CategoryView } from "./usda-categories";

export interface UsdaFoodPage {
  food: { fdcId: number; dataset: string; dataType: string; description: string; categoryId: number | null };
  category: CategoryView | null;
  portions: Array<{
    id: number; amount: number | null; unit: string | null; modifier: string | null;
    description: string | null; gramWeight: number;
  }>;
  /**
   * Every nutrient row the food has, in USDA's own display order (rank),
   * unranked last. A row whose nutrient id the nutrients table does not define
   * still shows, unnamed — the page reports what usda.db holds.
   */
  nutrients: Array<{ id: number; name: string | null; unit: string | null; amount: number | null; rank: number | null }>;
}

type FoodRow = { fdc_id: number; dataset: string; data_type: string; description: string; category_id: number | null };
type PortionRow = { id: number; amount: number | null; unit: string | null; modifier: string | null; description: string | null; gram_weight: number };
type NutrientRow = UsdaFoodPage["nutrients"][number];

export function usdaFood(db: Database, fdcId: number): UsdaFoodPage | null {
  const food = db
    .query<FoodRow, [number]>("SELECT fdc_id, dataset, data_type, description, category_id FROM foods WHERE fdc_id = ?1")
    .get(fdcId);
  if (!food) return null;

  const portions = db
    .query<PortionRow, [number]>(
      "SELECT id, amount, unit, modifier, description, gram_weight FROM portions WHERE fdc_id = ?1 ORDER BY id",
    )
    .all(fdcId);
  const nutrients = db
    .query<NutrientRow, [number]>(
      `SELECT fn.nutrient_id AS id, n.name, n.unit_name AS unit, fn.amount, n.rank
         FROM food_nutrients fn LEFT JOIN nutrients n ON n.id = fn.nutrient_id
        WHERE fn.fdc_id = ?1
        ORDER BY n.rank IS NULL, n.rank, n.name, fn.nutrient_id`,
    )
    .all(fdcId);

  return {
    food: {
      fdcId: food.fdc_id, dataset: food.dataset, dataType: food.data_type,
      description: food.description, categoryId: food.category_id,
    },
    category: categoryOf(food.category_id),
    portions: portions.map((p) => ({
      id: p.id, amount: p.amount, unit: p.unit, modifier: p.modifier, description: p.description, gramWeight: p.gram_weight,
    })),
    nutrients,
  };
}
