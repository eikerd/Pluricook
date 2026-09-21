import { describe, expect, test } from "bun:test";
import {
  chooseAnchor,
  classifyCategory,
  geometricMean,
  relativeAmount,
  type Composition,
  type FoodClass,
} from "./anchor";

const recipe = (id: string, parts: Array<[FoodClass, number]>): Composition => ({
  recipeId: id,
  parts: parts.map(([klass, grams]) => ({ klass, grams })),
});

describe("classifyCategory reads both USDA coding systems", () => {
  test("SR Legacy / Foundation ids", () => {
    expect(classifyCategory(13)).toBe("meat");        // Beef
    expect(classifyCategory(5)).toBe("meat");         // Poultry
    expect(classifyCategory(15)).toBe("meat");        // Finfish & shellfish
    expect(classifyCategory(20)).toBe("grain");
    expect(classifyCategory(16)).toBe("legume");
    expect(classifyCategory(11)).toBe("vegetable");
  });

  test("WWEIA four-digit codes — the miss that left a recipe with no reference", () => {
    // "Meat, ground, NFS" is WWEIA 2004. Reading only ids 1–25 called it not-meat.
    expect(classifyCategory(2004)).toBe("meat");
    expect(classifyCategory(2608)).toBe("meat");      // sausages
    expect(classifyCategory(2802)).toBe("legume");    // beans, peas, legumes
    expect(classifyCategory(2806)).toBe("legume");    // soy & meat alternatives
    expect(classifyCategory(4004)).toBe("grain");     // pasta, noodles, cooked grains
    expect(classifyCategory(6414)).toBe("vegetable"); // onions
  });

  test("things that must never anchor a dish, however large", () => {
    expect(classifyCategory(14)).toBe("unanchorable");   // beverages / water
    expect(classifyCategory(2)).toBe("unanchorable");    // spices
    expect(classifyCategory(6)).toBe("unanchorable");    // soups, sauces, stock
    expect(classifyCategory(7702)).toBe("unanchorable"); // tap water
    expect(classifyCategory(8402)).toBe("unanchorable"); // tomato condiments
    expect(classifyCategory(null)).toBe("unanchorable");
  });
});

describe("chooseAnchor — the hierarchy", () => {
  test("a meat dish anchors on meat", () => {
    const meatloaf = [
      recipe("a", [["meat", 907], ["vegetable", 150], ["dairy", 120], ["unanchorable", 200]]),
      recipe("b", [["meat", 907], ["vegetable", 110], ["dairy", 100]]),
      recipe("c", [["meat", 454], ["vegetable", 80], ["dairy", 60]]),
    ];
    const a = chooseAnchor(meatloaf);
    expect(a.kind).toBe("class");
    if (a.kind === "class") {
      expect(a.klass).toBe("meat");
      expect(a.via).toBe("priority");
      expect(a.unitLabel).toBe("% of meat");
    }
  });

  test("a baked good anchors on grain — baker's percentage", () => {
    const bread = [
      recipe("a", [["grain", 500], ["fat", 30], ["sweet", 20], ["unanchorable", 350]]),
      recipe("b", [["grain", 480], ["fat", 25], ["dairy", 50], ["unanchorable", 330]]),
    ];
    const a = chooseAnchor(bread);
    expect(a.kind === "class" && a.klass).toBe("grain");
  });

  test("a lentil soup anchors on legume even though stock outweighs it", () => {
    // Water and stock are unanchorable, so they cannot swamp the lentils.
    const soup = [
      recipe("a", [["legume", 300], ["vegetable", 350], ["fat", 30], ["unanchorable", 1500]]),
      recipe("b", [["legume", 250], ["vegetable", 300], ["fat", 25], ["unanchorable", 1400]]),
      recipe("c", [["legume", 400], ["vegetable", 280], ["fat", 40], ["unanchorable", 1600]]),
    ];
    const a = chooseAnchor(soup);
    expect(a.kind === "class" && a.klass).toBe("legume");
  });

  test("a garnish of meat does not hijack a pasta dish", () => {
    // Pancetta is present everywhere but small; pasta is the backbone.
    const carbonara = [
      recipe("a", [["grain", 400], ["meat", 60], ["dairy", 120]]),
      recipe("b", [["grain", 450], ["meat", 50], ["dairy", 100]]),
      recipe("c", [["grain", 380], ["meat", 70], ["dairy", 130]]),
    ];
    const a = chooseAnchor(carbonara);
    expect(a.kind === "class" && a.klass).toBe("grain");
  });

  test("with no backbone class, the dominant one anchors — the baker's fallback", () => {
    const ratatouille = [
      recipe("a", [["vegetable", 1200], ["fat", 60], ["unanchorable", 20]]),
      recipe("b", [["vegetable", 1000], ["fat", 45]]),
      recipe("c", [["vegetable", 1400], ["fat", 80]]),
    ];
    const a = chooseAnchor(ratatouille);
    expect(a.kind).toBe("class");
    if (a.kind === "class") {
      expect(a.klass).toBe("vegetable");
      expect(a.via).toBe("dominant");
    }
  });

  test("a custard anchors on dairy — the textbook 'cream in a custard' case", () => {
    const custard = [
      recipe("a", [["dairy", 600], ["sweet", 100]]),
      recipe("b", [["dairy", 550], ["sweet", 90]]),
    ];
    const a = chooseAnchor(custard);
    expect(a.kind === "class" && a.klass).toBe("dairy");
  });

  test("when nothing is shared across the corpus, it falls back to clr", () => {
    const grabBag = [
      recipe("a", [["fruit", 300], ["unanchorable", 50]]),
      recipe("b", [["nut", 200], ["unanchorable", 40]]),
      recipe("c", [["sweet", 250], ["unanchorable", 30]]),
    ];
    const a = chooseAnchor(grabBag);
    expect(a.kind).toBe("clr");
    expect(a.unitLabel).toBe("× geometric mean");
  });

  test("one vegetarian recipe among meat ones does not change the dish anchor", () => {
    const mostlyMeat = [
      recipe("a", [["meat", 900], ["vegetable", 100]]),
      recipe("b", [["meat", 900], ["vegetable", 120]]),
      recipe("c", [["meat", 450], ["vegetable", 90]]),
      recipe("veg", [["legume", 500], ["vegetable", 200]]),
    ];
    const a = chooseAnchor(mostlyMeat);
    expect(a.kind === "class" && a.klass).toBe("meat");
  });

  test("the decision always explains itself", () => {
    const a = chooseAnchor([recipe("a", [["meat", 500], ["vegetable", 50]])]);
    expect(a.reason.length).toBeGreaterThan(10);
    expect(a.candidates.length).toBeGreaterThan(0);
  });
});

describe("relativeAmount", () => {
  const comp = recipe("a", [["meat", 907], ["unanchorable", 14]]);

  test("against a class anchor it is a percent of that class's mass", () => {
    const anchor = chooseAnchor([comp]);
    expect(relativeAmount(anchor, comp, 14)).toBeCloseTo(1.54, 2);  // the charcuterie band
  });

  test("is scale invariant — a doubled recipe reads the same", () => {
    const doubled = recipe("b", [["meat", 1814], ["unanchorable", 28]]);
    const anchor = chooseAnchor([comp, doubled]);
    expect(relativeAmount(anchor, comp, 14)).toBe(relativeAmount(anchor, doubled, 28));
  });

  test("a recipe lacking the anchor class yields null, not a fake number", () => {
    const anchor = chooseAnchor([comp, comp, comp]);
    const vegetarian = recipe("v", [["legume", 400]]);
    expect(relativeAmount(anchor, vegetarian, 10)).toBeNull();
  });

  test("under clr it is a ratio to the geometric mean", () => {
    expect(geometricMean([10, 1000])).toBeCloseTo(100, 5);
    const c = recipe("c", [["fruit", 10], ["nut", 1000]]);
    const anchor = chooseAnchor([c], { minPresence: 2 });  // force clr
    expect(anchor.kind).toBe("clr");
    expect(relativeAmount(anchor, c, 1000)).toBeCloseTo(10, 2);
  });
});
