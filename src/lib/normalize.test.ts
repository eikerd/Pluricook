/**
 * Every shape below was observed on a real recipe page, not invented.
 * Sources are named in the test titles so a future failure can be checked
 * against the site that produced it.
 */

import { describe, expect, test } from "bun:test";
import {
  cleanText,
  countSteps,
  ingredientLines,
  parseAuthor,
  parseDuration,
  parseYield,
} from "./normalize";

describe("cleanText", () => {
  test("decodes entities that leak into JSON-LD (Budget Bytes, RecipeTin Eats)", () => {
    expect(cleanText("Salt &amp; pepper")).toBe("Salt & pepper");
    expect(cleanText("350&deg;F")).toBe("350°F");
    expect(cleanText("&frac12; cup")).toBe("½ cup");
    expect(cleanText("it&rsquo;s ready")).toBe("it’s ready");
  });

  test("decodes numeric entities, decimal and hex", () => {
    expect(cleanText("&#189; cup")).toBe("½ cup");
    expect(cleanText("&#xBD; cup")).toBe("½ cup");
  });

  test("strips tags and collapses whitespace", () => {
    expect(cleanText("<p>Mix   well</p><br/>Bake")).toBe("Mix well Bake");
  });

  test("returns null rather than an empty string", () => {
    expect(cleanText("")).toBeNull();
    expect(cleanText("   ")).toBeNull();
    expect(cleanText("<p></p>")).toBeNull();
    expect(cleanText(undefined)).toBeNull();
    expect(cleanText(42)).toBeNull();
  });

  test("leaves an unknown entity alone rather than mangling it", () => {
    expect(cleanText("a &notarealentity; b")).toBe("a &notarealentity; b");
  });
});

describe("parseDuration", () => {
  test("canonical ISO-8601", () => {
    expect(parseDuration("PT1H30M")).toBe(90);
    expect(parseDuration("PT45M")).toBe(45);
    expect(parseDuration("PT2H")).toBe(120);
  });

  test("non-canonical ISO seen in the wild", () => {
    expect(parseDuration("PT80M")).toBe(80);      // jamieoliver, natashaskitchen
    expect(parseDuration("PT01H30M")).toBe(90);   // Taste of Home, zero-padded
    expect(parseDuration("PT85M")).toBe(85);      // Spend With Pennies
    expect(parseDuration("P1DT2H")).toBe(1560);   // slow-cooker recipes
  });

  test("free text, because Bon Appétit emits it despite the schema", () => {
    expect(parseDuration("40 minutes")).toBe(40);
    expect(parseDuration("1 hour 25 minutes")).toBe(85);
    expect(parseDuration("1 hr 5 min")).toBe(65);
    expect(parseDuration("90 mins")).toBe(90);
  });

  test("returns null rather than guessing", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
    expect(parseDuration("overnight")).toBeNull();
    expect(parseDuration("PT")).toBeNull();
    expect(parseDuration("a while")).toBeNull();
  });

  test("a bare P with no time parts is not a duration", () => {
    expect(parseDuration("P")).toBeNull();
  });
});

describe("parseYield", () => {
  test("bare numbers and numeric strings", () => {
    expect(parseYield(6)).toEqual({ servings: 6, raw: "6" });
    expect(parseYield("4")).toEqual({ servings: 4, raw: "4" });     // Delish
    expect(parseYield(["6"])).toEqual({ servings: 6, raw: "6" });   // RecipeTin Eats
  });

  test("serving-word forms", () => {
    expect(parseYield("8 serving(s)")?.servings).toBe(8);           // Pioneer Woman
    expect(parseYield("6 - 8 serving(s)")?.servings).toBe(6);       // Delish — low end
    expect(parseYield("7 slices")?.servings).toBe(7);               // Budget Bytes
    expect(parseYield("8 servings")?.servings).toBe(8);             // Preppy Kitchen
  });

  test("a count buried after a container word still wins (Food.com)", () => {
    // "1 loaf, 10 serving(s)" must read 10, not 1.
    expect(parseYield("1 loaf, 10 serving(s)")?.servings).toBe(10);
    expect(parseYield("1 loaf (16 pieces)")?.servings).toBe(16);    // Taste of Home
  });

  test("prose forms", () => {
    expect(parseYield("Makes 16")?.servings).toBe(16);              // Bon Appétit
  });

  test("mixed arrays prefer the entry carrying a number (King Arthur)", () => {
    const parsed = parseYield(["18", "1 loaf"]);
    expect(parsed?.servings).toBe(18);
    expect(parsed?.raw).toBe("18, 1 loaf");
  });

  test("always keeps the raw string, because the spread is itself a finding", () => {
    expect(parseYield("6 - 8 serving(s)")?.raw).toBe("6 - 8 serving(s)");
  });

  test("returns null when there is nothing to read", () => {
    expect(parseYield(undefined)).toBeNull();
    expect(parseYield("")).toBeNull();
    expect(parseYield([])).toBeNull();
  });

  test("keeps the raw text when no number is present", () => {
    expect(parseYield("a generous amount")).toEqual({ servings: null, raw: "a generous amount" });
  });
});

describe("countSteps", () => {
  test("a flat list of HowToStep", () => {
    expect(countSteps([{ "@type": "HowToStep" }, { "@type": "HowToStep" }])).toBe(2);
  });

  test("plain strings (King Arthur)", () => {
    expect(countSteps(["Mix", "Bake", "Cool"])).toBe(3);
  });

  test("HowToSection nesting counts STEPS, not sections (RecipeTin Eats)", () => {
    // The trap: a flat parser returns 2 here and silently under-counts.
    const sectioned = [
      { "@type": "HowToSection", itemListElement: [{}, {}, {}] },
      { "@type": "HowToSection", itemListElement: [{}, {}] },
    ];
    expect(countSteps(sectioned)).toBe(5);
  });

  test("a mixed list of sections and loose steps", () => {
    expect(
      countSteps([{ "@type": "HowToSection", itemListElement: [{}, {}] }, { "@type": "HowToStep" }]),
    ).toBe(3);
  });

  test("a single string is one step", () => {
    expect(countSteps("Mix everything and bake for an hour.")).toBe(1);
  });

  test("a numbered method in one string counts its markers", () => {
    expect(countSteps("1. Mix the dry. 2. Add wet. 3. Bake.")).toBe(3);
  });

  test("returns null for nothing", () => {
    expect(countSteps(undefined)).toBeNull();
    expect(countSteps([])).toBeNull();
    expect(countSteps("")).toBeNull();
  });
});

describe("ingredientLines", () => {
  test("plain strings, cleaned", () => {
    expect(ingredientLines(["1 lb ground beef", "&frac12; cup milk"]))
      .toEqual(["1 lb ground beef", "½ cup milk"]);
  });

  test("PropertyValue objects, which real importers drop (Tandoor #4380)", () => {
    expect(
      ingredientLines([{ "@type": "PropertyValue", value: "3/4", unitText: "cup", name: "sugar" }]),
    ).toEqual(["3/4 cup sugar"]);
  });

  test("drops empty entries instead of emitting blanks", () => {
    expect(ingredientLines(["salt", "", "   ", null, 7])).toEqual(["salt"]);
  });

  test("a single string is still a list", () => {
    expect(ingredientLines("1 onion")).toEqual(["1 onion"]);
  });

  test("missing ingredients give an empty array, never undefined", () => {
    expect(ingredientLines(undefined)).toEqual([]);
  });
});

describe("parseAuthor", () => {
  test("string (Food.com)", () => {
    expect(parseAuthor("Nagi")).toBe("Nagi");
  });

  test("object (Budget Bytes, Delish)", () => {
    expect(parseAuthor({ "@type": "Person", name: "Beth Moncel" })).toBe("Beth Moncel");
  });

  test("array (Bon Appétit, BBC Good Food)", () => {
    expect(parseAuthor([{ name: "A" }, { name: "B" }])).toBe("A, B");
  });

  test("null when the page names nobody", () => {
    expect(parseAuthor(undefined)).toBeNull();
    expect(parseAuthor({})).toBeNull();
  });
});
