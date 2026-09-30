import { describe, expect, test } from "bun:test";
import { nutrientIdResolver } from "./usda-csv";

// Rows as nutrient.csv gives them: an FDC id, and the old SR nutrient number.
const NUTRIENTS = [
  { id: "1008", name: "Energy", unit_name: "KCAL", nutrient_nbr: "208" },
  { id: "1003", name: "Protein", unit_name: "G", nutrient_nbr: "203" },
  { id: "2047", name: "Energy (Atwater General Factors)", unit_name: "KCAL", nutrient_nbr: "957" },
  { id: "1062", name: "Energy", unit_name: "kJ", nutrient_nbr: "" },
];

describe("nutrientIdResolver", () => {
  const resolve = nutrientIdResolver(NUTRIENTS);

  test("a row that names its nutrient by id keeps it", () => {
    expect(resolve(1008)).toBe(1008);
    expect(resolve(1062)).toBe(1062);
  });

  test("a survey row that names it by the old number gets the id", () => {
    expect(resolve(208)).toBe(1008);
    expect(resolve(203)).toBe(1003);
    expect(resolve(957)).toBe(2047);
  });

  test("a value the download defines neither way is unknown, not guessed", () => {
    expect(resolve(2066)).toBeNull();
    expect(resolve(999)).toBeNull();
  });

  test("a number two nutrients share is ambiguous, so it is not translated", () => {
    const shared = nutrientIdResolver([
      { id: "1008", nutrient_nbr: "208" },
      { id: "2000", nutrient_nbr: "208" },
    ]);
    expect(shared(208)).toBeNull();
    expect(shared(1008)).toBe(1008);
  });
});
