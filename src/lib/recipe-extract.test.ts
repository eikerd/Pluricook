import { describe, expect, test } from "bun:test";
import { extractRecipe, findRecipeNode, jsonLdBlocks } from "./recipe-extract";

const ld = (obj: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;

const BASE = {
  sourceUrl: "https://www.example.com/meatloaf-recipe/",
  siteName: "Example Kitchen",
  acquisition: "fetch" as const,
  dish: "meatloaf",
  capturedAt: "2026-09-20",
};

const RECIPE = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "The Best Meatloaf",
  author: { "@type": "Person", name: "Pat Cook" },
  recipeIngredient: ["2 lb ground beef", "1 cup breadcrumbs", "&frac12; cup milk"],
  recipeInstructions: [{ "@type": "HowToStep" }, { "@type": "HowToStep" }],
  recipeYield: "8 serving(s)",
  totalTime: "PT1H30M",
  prepTime: "PT20M",
  cookTime: "PT70M",
};

describe("findRecipeNode", () => {
  test("finds a top-level Recipe", () => {
    expect(findRecipeNode(RECIPE)?.name).toBe("The Best Meatloaf");
  });

  test("finds a Recipe inside @graph (the Yoast pattern, 4 of 10 pages)", () => {
    const graph = { "@context": "x", "@graph": [{ "@type": "WebPage" }, RECIPE] };
    expect(findRecipeNode(graph)?.name).toBe("The Best Meatloaf");
  });

  test("finds a Recipe in a top-level array", () => {
    expect(findRecipeNode([{ "@type": "Organization" }, RECIPE])?.name).toBe("The Best Meatloaf");
  });

  test("handles @type given as an array", () => {
    expect(findRecipeNode({ ...RECIPE, "@type": ["Recipe", "NewsArticle"] })).toBeTruthy();
  });

  test("returns null when there is no Recipe", () => {
    expect(findRecipeNode({ "@type": "WebPage" })).toBeNull();
    expect(findRecipeNode({ "@graph": [{ "@type": "Article" }] })).toBeNull();
  });

  test("does not recurse forever on a self-referencing object", () => {
    const loop: Record<string, unknown> = { "@type": "WebPage" };
    loop["@graph"] = loop;
    expect(findRecipeNode(loop)).toBeNull();
  });
});

describe("jsonLdBlocks", () => {
  test("finds every block, with either quote style", () => {
    const html = `<script type='application/ld+json'>{"a":1}</script>
                  <script type="application/ld+json">{"b":2}</script>`;
    expect(jsonLdBlocks(html)).toHaveLength(2);
  });

  test("ignores ordinary scripts", () => {
    expect(jsonLdBlocks(`<script>var x = 1;</script>`)).toHaveLength(0);
  });
});

describe("extractRecipe — success", () => {
  const result = extractRecipe({ ...BASE, html: ld(RECIPE) });

  test("extracts and normalizes the fields", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.ingredientLines).toEqual([
      "2 lb ground beef", "1 cup breadcrumbs", "½ cup milk",
    ]);
    expect(result.recipe.servings).toBe(8);
    expect(result.recipe.servingsRaw).toBe("8 serving(s)");
    expect(result.recipe.totalTimeMinutes).toBe(90);
    expect(result.recipe.stepCount).toBe(2);
  });

  test("attaches complete provenance", () => {
    if (!result.ok) throw new Error("expected success");
    const p = result.recipe.provenance;
    expect(p.host).toBe("example.com");          // www stripped
    expect(p.sourceUrl).toBe(BASE.sourceUrl);
    expect(p.author).toBe("Pat Cook");
    expect(p.sourceTitle).toBe("The Best Meatloaf");
    expect(p.acquisitionAtCapture).toBe("fetch");
    expect(p.method).toBe("structured-data");
  });

  test("keeps the raw time string beside the parsed one", () => {
    if (!result.ok) throw new Error("expected success");
    expect(result.recipe.totalTimeRaw).toBe("PT1H30M");
  });

  test("stores no step text — only a count", () => {
    if (!result.ok) throw new Error("expected success");
    expect(Object.keys(result.recipe)).not.toContain("instructions");
    expect(JSON.stringify(result.recipe)).not.toContain("HowToStep");
  });
});

describe("extractRecipe — real-world awkwardness", () => {
  test("survives one malformed block beside a good one (Paula Deen's shape)", () => {
    const html =
      `<script type="application/ld+json">{ not json }</script>` +
      `<script type="application/ld+json">${JSON.stringify(RECIPE)}</script>`;
    const r = extractRecipe({ ...BASE, html });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toContain("1 unparseable JSON-LD block(s)");
  });

  test("G19: a raw line break inside a JSON-LD string (Joshua Weissman's shape)", () => {
    // Strict JSON forbids a literal newline in a string; the page ships one in
    // its description, so JSON.parse rejected the only block it has.
    const html =
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Recipe",` +
      `"name":"Garlic Noodles","description":"Adapted from The Wok.\nCheap and good.",` +
      `"recipeIngredient":["1 lb (450g) spaghetti","\t20 cloves garlic"]}</script>`;
    const r = extractRecipe({ ...BASE, html });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.ingredientLines).toEqual(["1 lb (450g) spaghetti", "20 cloves garlic"]);
    expect(r.warnings.join(" ")).not.toContain("unparseable");
  });

  test("counts sectioned steps, not sections (RecipeTin Eats)", () => {
    const r = extractRecipe({
      ...BASE,
      html: ld({
        ...RECIPE,
        recipeInstructions: [
          { "@type": "HowToSection", itemListElement: [{}, {}, {}] },
          { "@type": "HowToSection", itemListElement: [{}, {}] },
        ],
      }),
    });
    if (!r.ok) throw new Error("expected success");
    expect(r.recipe.stepCount).toBe(5);
  });

  test("derives totalTime from prep + cook, and says so", () => {
    const { totalTime, ...noTotal } = RECIPE;
    const r = extractRecipe({ ...BASE, html: ld(noTotal) });
    if (!r.ok) throw new Error("expected success");
    expect(r.recipe.totalTimeMinutes).toBe(90);
    expect(r.warnings).toContain("totalTime derived from prepTime + cookTime");
  });

  test("warns about a missing author rather than inventing one", () => {
    const { author, ...anon } = RECIPE;
    const r = extractRecipe({ ...BASE, html: ld(anon) });
    if (!r.ok) throw new Error("expected success");
    expect(r.recipe.provenance.author).toBeNull();
    expect(r.warnings).toContain("no author named");
  });
});

describe("extractRecipe — refusals", () => {
  test("no JSON-LD at all", () => {
    const r = extractRecipe({ ...BASE, html: "<html><body>A recipe, in prose.</body></html>" });
    expect(r).toMatchObject({ ok: false, reason: "no-json-ld", blocks: 0 });
  });

  test("JSON-LD present but no Recipe node (Paula Deen)", () => {
    const r = extractRecipe({ ...BASE, html: ld({ "@type": "WebPage", name: "Recipes" }) });
    expect(r).toMatchObject({ ok: false, reason: "no-recipe-node" });
  });

  test("every block unparseable", () => {
    const r = extractRecipe({
      ...BASE,
      html: `<script type="application/ld+json">{ oops </script>`,
    });
    expect(r).toMatchObject({ ok: false, reason: "unparseable-json-ld", blocks: 1 });
  });

  test("a Recipe node with no ingredients is not a recipe", () => {
    const { recipeIngredient, ...bare } = RECIPE;
    const r = extractRecipe({ ...BASE, html: ld(bare) });
    expect(r).toMatchObject({ ok: false, reason: "no-ingredients" });
  });

  test("G33: one ingredient line is not a recipe (Kikkoman's markup says only 'Chicken')", () => {
    const r = extractRecipe({ ...BASE, html: ld({ ...RECIPE, recipeIngredient: ["Chicken"] }) });
    expect(r).toMatchObject({ ok: false, reason: "one-ingredient" });
  });

  test("never returns a half-filled recipe on failure", () => {
    const r = extractRecipe({ ...BASE, html: "<html></html>" });
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("recipe");
  });
});

describe("extractRecipe — more than one Recipe node on a page", () => {
  const stub = { "@type": "Recipe", name: "Teaser" };   // no ingredients

  test("a stub in an earlier block does not hide the real recipe in a later one", () => {
    const html =
      `<script type="application/ld+json">${JSON.stringify(stub)}</script>` +
      `<script type="application/ld+json">${JSON.stringify(RECIPE)}</script>`;
    const r = extractRecipe({ ...BASE, html });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.recipe.provenance.sourceTitle).toBe("The Best Meatloaf");
  });

  test("nor does a stub beside it in the same @graph", () => {
    const r = extractRecipe({ ...BASE, html: ld({ "@graph": [stub, RECIPE] }) });
    expect(r.ok).toBe(true);
  });

  test("Recipe nodes with no ingredients anywhere is 'no-ingredients', not 'no-recipe-node'", () => {
    const r = extractRecipe({ ...BASE, html: ld({ "@graph": [stub, stub] }) });
    expect(r).toMatchObject({ ok: false, reason: "no-ingredients" });
  });
});
