import { describe, expect, test } from "bun:test";
import { parseLine, singular } from "./ingredient-line";

describe("singular", () => {
  test("folds the plurals a recipe uses", () => {
    expect(singular("cloves")).toBe("clove");
    expect(singular("stalks")).toBe("stalk");
    expect(singular("leaves")).toBe("leaf");
    expect(singular("berries")).toBe("berry");
    expect(singular("glass")).toBe("glass");
  });
});

describe("parseLine — repairing the unit", () => {
  // Before the repair the raw parser returned unit="garlic", "yellow", "onion".
  test.each([
    ["2 large eggs", 2, "large", "eggs"],
    ["2 garlic cloves, minced", 2, "clove", "garlic"],
    ["3 cloves garlic, minced", 3, "clove", "garlic"],
    ["2 stalks celery", 2, "stalk", "celery"],
    ["2 celery stalks, chopped", 2, "stalk", "celery"],
    ["1 cup milk", 1, "cup", "milk"],
    ["2 lb ground beef", 2, "lb", "ground beef"],
  ])("%s", (line, quantity, unit, nameStart) => {
    const p = parseLine(line);
    expect(p.quantity).toBe(quantity);
    expect(p.unit).toBe(unit);
    expect(p.name.toLowerCase().startsWith(nameStart)).toBe(true);
  });

  test("a word that is not a unit goes back into the name", () => {
    const p = parseLine("1 yellow onion, chopped");
    expect(p.unit).toBe("each");
    expect(p.name.toLowerCase()).toContain("yellow onion");
  });

  test("a food standing where the unit should be is recovered", () => {
    const p = parseLine("1 onion (diced)");
    expect(p.unit).toBe("each");
    expect(p.name.toLowerCase()).toContain("onion");
  });

  test("a bare count noun that IS the food is left alone", () => {
    // "1 teaspoon ground cloves" is the spice; there is no other word to keep.
    const p = parseLine("1 teaspoon ground cloves");
    expect(p.unit).toBe("teaspoon");
    expect(p.name.toLowerCase()).toContain("cloves");
  });

  test("keeps the raw line for tracing a surprising number", () => {
    expect(parseLine("2 large eggs").rawLine).toBe("2 large eggs");
  });
});

describe("parseLine — the raw parser's 'to taste' default", () => {
  test("a unitless count is a count, not 'to taste'", () => {
    // The raw parser returns unit="to taste" whenever it finds no unit at all.
    const p = parseLine("1 onion");
    expect(p.unit).toBe("each");
    expect(p.name.toLowerCase()).toBe("onion");
  });

  test("a line with no number really is unquantified", () => {
    expect(parseLine("Kosher salt, to taste").unit.toLowerCase()).toBe("to taste");
  });
});
