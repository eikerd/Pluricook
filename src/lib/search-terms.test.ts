import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { queryDataset, termPage } from "./admin-queries";
import {
  parseRankedList, readSearchTerms, slugOf, splitNote, termsFromList, validateTerms, type SearchTerm,
} from "./search-terms";

const EXCERPT = `Top 100 Most Searched Recipes
Rank 1 – 20: The Global Staples

1. Pancake Recipe (consistently #1 worldwide)
2. Banana Bread Recipe

Rank 21 – 40: Comfort Mains & Baking Favorites

26. Shepherd’s Pie Recipe
28. Guinness Stew / Beef Stroganoff
53. Crustless / Classic Quiche Recipe
`;

describe("parseRankedList", () => {
  test("each numbered line keeps its rank, and the band it sits under", () => {
    expect(parseRankedList(EXCERPT)).toEqual([
      { rank: 1, group: "The Global Staples", listed: "Pancake Recipe (consistently #1 worldwide)" },
      { rank: 2, group: "The Global Staples", listed: "Banana Bread Recipe" },
      { rank: 26, group: "Comfort Mains & Baking Favorites", listed: "Shepherd’s Pie Recipe" },
      { rank: 28, group: "Comfort Mains & Baking Favorites", listed: "Guinness Stew / Beef Stroganoff" },
      { rank: 53, group: "Comfort Mains & Baking Favorites", listed: "Crustless / Classic Quiche Recipe" },
    ]);
  });
});

describe("splitNote", () => {
  test("an aside in brackets is a note, not part of what people search", () => {
    expect(splitNote("Pancake Recipe (consistently #1 worldwide)")).toEqual({ term: "Pancake Recipe", note: "consistently #1 worldwide" });
    expect(splitNote("Banana Bread Recipe")).toEqual({ term: "Banana Bread Recipe" });
  });
});

describe("slugOf", () => {
  test("gives the dish keys the library already uses", () => {
    expect(slugOf("Meatloaf Recipe")).toBe("meatloaf");
    expect(slugOf("Lentil Soup Recipe")).toBe("lentil-soup");
  });

  test("drops 'Recipe(s)', apostrophes and accents", () => {
    expect(slugOf("Chicken Breast Recipes")).toBe("chicken-breast");
    expect(slugOf("Shepherd’s Pie Recipe")).toBe("shepherds-pie");
    expect(slugOf("General Tso's Chicken")).toBe("general-tsos-chicken");
    expect(slugOf("Crème Brûlée Recipe")).toBe("creme-brulee");
    expect(slugOf("Mac and Cheese Recipe")).toBe("mac-and-cheese");
  });
});

describe("termsFromList", () => {
  const listed = parseRankedList(EXCERPT);

  test("a line naming two different dishes becomes two terms at the same rank", () => {
    const terms = termsFromList(listed, {
      28: { split: ["Guinness Stew", "Beef Stroganoff"] },
      53: { term: "Quiche Recipe", aliases: ["Crustless Quiche Recipe", "Classic Quiche Recipe"] },
    });
    const at28 = terms.filter((t) => t.rank === 28);
    expect(at28.map((t) => [t.slug, t.term])).toEqual([["guinness-stew", "Guinness Stew"], ["beef-stroganoff", "Beef Stroganoff"]]);
    expect(at28[0]!.note).toContain("Guinness Stew / Beef Stroganoff");
  });

  test("a line naming variants of one dish becomes one term, the variants its aliases", () => {
    const terms = termsFromList(listed, {
      28: { split: ["Guinness Stew", "Beef Stroganoff"] },
      53: { term: "Quiche Recipe", aliases: ["Crustless Quiche Recipe", "Classic Quiche Recipe"] },
    });
    expect(terms.find((t) => t.rank === 53)).toMatchObject({
      slug: "quiche", term: "Quiche Recipe", aliases: ["Crustless Quiche Recipe", "Classic Quiche Recipe"],
    });
    expect(terms.find((t) => t.rank === 1)).toEqual({
      slug: "pancake", term: "Pancake Recipe", rank: 1, group: "The Global Staples", note: "consistently #1 worldwide",
    });
  });

  test("a line naming two things with no decision is refused, not guessed", () => {
    expect(() => termsFromList(listed, { 28: { split: ["Guinness Stew", "Beef Stroganoff"] } })).toThrow(/#53/);
  });
});

describe("validateTerms", () => {
  const ok: SearchTerm = { slug: "meatloaf", term: "Meatloaf Recipe", rank: 8, group: null };

  test("two terms may not share a slug — a recipe could not tell which it attaches to", () => {
    expect(() => validateTerms([ok, { ...ok, term: "Meat Loaf" }])).toThrow(/meatloaf/);
  });

  test("a slug must be a dish key the routes can open", () => {
    expect(() => validateTerms([{ ...ok, slug: "Meat Loaf" }])).toThrow(/Meat Loaf/);
    expect(() => validateTerms([{ ...ok, rank: 0 }])).toThrow(/rank/);
  });
});

// Each test reads the file itself: bun registers no tests from a describe
// whose callback awaits, and says nothing about it.
describe("the seeded terms", () => {
  test("hold all hundred ranks, #28 twice", async () => {
    const terms = await readSearchTerms();
    const ranks = terms.map((t) => t.rank).filter((r): r is number => r !== null);
    expect(new Set(ranks).size).toBe(100);
    expect(Math.min(...ranks)).toBe(1);
    expect(Math.max(...ranks)).toBe(100);
    expect(terms.filter((t) => t.rank === 28).map((t) => t.slug)).toEqual(["guinness-stew", "beef-stroganoff"]);
  });

  test("every dish in the library attaches to a term", async () => {
    const slugs = new Set((await readSearchTerms()).map((t) => t.slug));
    const dishes = [...new Glob("data/recipes/*.json").scanSync(".")].map((p) => p.slice(p.lastIndexOf("/") + 1, -".json".length));
    expect(dishes.length).toBeGreaterThan(0);
    expect(dishes.filter((d) => !slugs.has(d))).toEqual([]);
  });
});

describe("the Search terms table", () => {
  test("lists every term by rank, with how many recipes attach to each", async () => {
    const page = (await queryDataset("search-terms", { pageSize: 500 }))!;
    expect(page.columns.map((c) => c.key)).toEqual(["rank", "term", "group", "slug", "recipes"]);
    expect(page.total).toBe((await readSearchTerms()).length);
    expect(page.rows[0]).toMatchObject({ rank: 1, slug: "pancake", recipes: 0 });
    const meatloaf = page.rows.find((r) => r.slug === "meatloaf")!;
    expect(meatloaf.recipes).toBe((await termPage("meatloaf"))!.recipes.length);
    expect(meatloaf.recipes).toBeGreaterThan(0);
  });

  test("a term off the list sorts last whichever way rank is sorted", async () => {
    for (const dir of ["asc", "desc"]) {
      const page = (await queryDataset("search-terms", { sort: "rank", dir, pageSize: 500 }))!;
      expect(page.rows.at(-1)).toMatchObject({ rank: null, slug: "detroit-pizza" });
    }
  });

  test("says which column it is sorted by and which way, so the header can show it", async () => {
    expect(await queryDataset("search-terms", {})).toMatchObject({ sort: "rank", dir: "asc" });
    expect(await queryDataset("search-terms", { sort: "term", dir: "desc" })).toMatchObject({ sort: "term", dir: "desc" });
    expect(await queryDataset("search-terms", { sort: "no-such-column" })).toMatchObject({ sort: "rank", dir: "asc" });
  });

  test("the filter finds a term by its aliases", async () => {
    const page = (await queryDataset("search-terms", { q: "filet mignon" }))!;
    expect(page.rows.map((r) => r.slug)).toEqual(["beef-tenderloin"]);
  });
});

describe("termPage", () => {
  test("holds the term, and its recipes in the Recipes table's columns less Dish", async () => {
    const page = (await termPage("meatloaf"))!;
    expect(page.term).toMatchObject({ slug: "meatloaf", term: "Meatloaf Recipe", rank: 8 });
    expect(page.columns.map((c) => c.key)).not.toContain("dish");
    expect(page.recipes.every((r) => r.dish === "meatloaf")).toBe(true);
  });

  test("a slug no term has is null", async () => {
    expect(await termPage("no-such-dish")).toBeNull();
  });
});
