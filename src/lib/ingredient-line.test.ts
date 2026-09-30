import { describe, expect, test } from "bun:test";
import { conversionInput, extractPreparation, parseLine, singular } from "./ingredient-line";

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

describe("extractPreparation — the raw parser never sets it", () => {
  test("finds the word wherever the recipe put it", () => {
    expect(extractPreparation("1 teaspoon ground oregano")).toBe("ground");
    expect(extractPreparation("1 medium onion, finely chopped")).toBe("chopped");
    expect(extractPreparation("2 stalks celery (diced)")).toBe("diced");
    expect(extractPreparation("1 tsp dried oregano leaves")).toBe("leaves");
  });

  test("returns null when the line states none", () => {
    expect(extractPreparation("2 large eggs")).toBeNull();
    expect(extractPreparation("1 cup milk")).toBeNull();
  });

  test("parseLine now carries it through to conversion", () => {
    expect(parseLine("1 teaspoon ground oregano").preparation).toBe("ground");
    expect(parseLine("1 cup sliced onion").preparation).toBe("sliced");
  });
});

describe("stray punctuation before the name", () => {
  test.each([
    ["1 tbsp. soy sauce", "soy sauce"],
    ["2 qt. vegetable broth", "vegetable broth"],
    ["1 c. grated parmesan cheese", "grated parmesan cheese"],
  ])("%p names %p", (line, name) => {
    expect(parseLine(line).name).toBe(name);
  });

  test("a leading decimal point belongs to the quantity and survives", () => {
    expect(parseLine(".5 cup milk").quantity).toBe(0.5);
  });
});

// Each case below is an entry in docs/recipe-gotchas.md; the G-number is the link.
describe("recipe gotchas — docs/recipe-gotchas.md", () => {
  // G6: "½-⅞" was a code-point range (U+00BD–U+215E), not a list of fractions,
  // and it swallowed bullets and dashes into the number.
  test.each(["• 3 cups AP flour", "∙ 3 cups AP flour", "· 3 cups AP flour", "▪ 3 cups AP flour", "* 3 cups AP flour", "- 3 cups AP flour"])(
    "G6: the bullet in %p is not part of the number",
    (line) => {
      expect(parseLine(line)).toMatchObject({ quantity: 3, unit: "cups", name: "AP flour" });
    },
  );

  test("G6: an en-dash range reads as its first figure, as a hyphen range does", () => {
    expect(parseLine("2–3 cloves garlic")).toMatchObject({ quantity: 2, unit: "clove", name: "garlic" });
    expect(parseLine("2-3 cloves garlic")).toMatchObject({ quantity: 2, unit: "clove", name: "garlic" });
  });

  // G7: ¼ is U+00BC, one code point before ½, so the old range left it out.
  test.each([
    ["¼ tsp salt", 0.25, "tsp", "salt"],
    ["¼ cup ketchup", 0.25, "cup", "ketchup"],
    ["2¼ cups flour", 2.25, "cups", "flour"],
    ["1 ¼ cups flour", 1.25, "cups", "flour"],
  ])("G7: %p", (line, quantity, unit, name) => {
    expect(parseLine(line)).toMatchObject({ quantity, unit, name });
  });

  // G11: the mass a line states is the best figure it has. G12: decimals too.
  test.each([
    ["3 cups (360g) AP Flour", 360, "AP Flour"],
    ["1 cup (240 g) whole milk", 240, "whole milk"],
    ["⅛ tsp (0.25g) Nutmeg", 0.25, "Nutmeg"],
    ["1 tbsp (0.015 kg) honey", 15, "honey"],
  ])("G11: %p states %p g", (line, grams, name) => {
    const p = parseLine(line);
    expect(p.statedGrams).toBe(grams);
    expect(p.name).toBe(name);
  });

  test("G11: stated grams outrank the volume when converting", () => {
    expect(conversionInput(parseLine("3 cups (360g) AP Flour"))).toEqual({ quantity: 360, unit: "g" });
    expect(conversionInput(parseLine("3 cups AP flour"))).toEqual({ quantity: 3, unit: "cups" });
  });

  test("G11: ounces in brackets are not taken as mass — '(8 oz)' is as often fluid", () => {
    expect(parseLine("1 cup (8 oz) milk").statedGrams).toBeNull();
  });

  test("G11: a length in brackets is not a mass", () => {
    expect(parseLine("2 cups (6mm dice) apples").statedGrams).toBeNull();
  });

  // G18: the same amount in a second system, after a slash — RecipeTin Eats' style.
  test.each([
    ["2 cups / 400g dried lentils", 400, "dried lentils"],
    ["1 kg / 2 lb ground beef (mince)", null, "ground beef (mince)"],
    ["400g / 14 oz crushed tomato", null, "crushed tomato"],
  ])("G18: %p states %p g, and the alternate leaves the name", (line, grams, name) => {
    const p = parseLine(line);
    expect(p.statedGrams).toBe(grams);
    expect(p.name).toBe(name);
  });

  test("G18: the metric side converts, whichever side of the slash it is on", () => {
    expect(conversionInput(parseLine("2 cups / 400g dried lentils"))).toEqual({ quantity: 400, unit: "g" });
    expect(conversionInput(parseLine("1 kg / 2 lb ground beef"))).toEqual({ quantity: 1, unit: "kg" });
  });

  test("G18: a slash with no measure after it is left to the name", () => {
    expect(parseLine("2 cups / sliced peaches").name).toBe("sliced peaches");
    expect(parseLine("1 cup half/half").name).toBe("half/half");
    expect(parseLine("2 cups / 2 large eggs").statedGrams).toBeNull();
  });
});
