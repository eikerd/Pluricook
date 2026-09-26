# Recipe gotchas

The ways real recipes break extraction, parsing and comparison, logged as they
turn up so that each one can become a test.

Every entry quotes the recipe exactly as published, then says what goes wrong,
what should happen, and what Pluricook does **today**. "Today" is observed,
never guessed: run the source through `bun scripts/probe-lines.ts <file>` (add
`--strip-bullets` to see the lines as JSON-LD would deliver them) and copy what
comes back. When a fix lands, run it again and update the entry. When a test
covers an entry, name the test in it.

Sources live in `data/fixtures/`, verbatim: typos, wrapped lines and odd
bullets included. Never tidy a fixture; the mess is the test.

Numbers are permanent. A new gotcha takes the next number, and a fixed one keeps
its number and says it is fixed.

## Cases

| Case | Source | Fixture |
|---|---|---|
| Apple fritters | Kitchen in the shire, pasted by the owner from a PDF on 2026-09-26; no URL on file. Also the APPLE_FRITTERS sheet in Google Drive. | `data/fixtures/apple-fritters.txt` |

## Index

| # | Gotcha | Kind | Today |
|---|---|---|---|
| G1 | A sub-recipe used as an ingredient | structure | unmatched |
| G2 | One sub-recipe feeds two components | structure | not modelled |
| G3 | A sub-recipe goes by different names | structure | not modelled |
| G4 | A sub-recipe's yield is not the sum of its inputs | structure | not modelled |
| G5 | Recipes have components, not one list | structure | partly |
| G6 | A bullet is read as part of the number | text | broken |
| G7 | ¼ is not read as a number | text | broken |
| G8 | Lines wrapped mid-ingredient | text | broken |
| G9 | A method step inside the ingredient list | text | broken |
| G10 | Text damaged by PDF copying | text | partly |
| G11 | Stated grams are thrown away | quantity | broken |
| G12 | Decimal grams leak into the name | quantity | broken |
| G13 | Compound measures | quantity | broken |
| G14 | A counted item with no weight | quantity | broken |
| G15 | Plain foods match the wrong USDA record | matching | broken |
| G16 | One food, several names, several components | matching | OK |

---

## Structure

### G1 · A sub-recipe used as an ingredient

**Seen in** apple fritters: `Brown Butter (from above)` in the filling. The
brown butter is made earlier, in its own section, Milk Toasted Brown Butter:
`3 tBsp (42g) Butter` and `1½ tBsp (10g) Whole Milk Powder`.

**Goes wrong.** Read as an ordinary line, it is an ingredient nobody can
identify, with no amount. The obvious repair is a trap: alias `brown butter`
to USDA butter and the line converts, and then the butter is counted twice,
once in its own section and again here.

**Should.** Resolve the line to the section that makes it. The butter and the
milk powder count once, in that section; the reference adds no new food. The
mass it carries into the filling is that section's yield (G4).

**Today.** `0 to taste · "Brown Butter (from above)"`, unconvertible, so it
lands in Unmatched lines. The section's own lines convert separately.

### G2 · One sub-recipe feeds two components

**Seen in** apple fritters, the cider reduction:

```
• 1 cup (240g) Fresh Apple Cider,
unsweetened
- Reduce to about 2 tBsp (40g total),
• about 2⅛ tsp (15g) for the apples
• about1tBsp + ½ tsp (25g) for the
glaze
```

The filling then lists `2⅛ tsp (15g) Apple Cider Reduction` and the glaze
`1tBsp + ½ tsp (25g) Cider Reduction`.

**Goes wrong.** The structure is a graph, not a tree: one section's output is
used by two others. The allocation lines ("for the apples", "for the glaze")
carry the same bullet as ingredients, yet they are not ingredients. They say
how the yield is divided.

**Should.** A sub-recipe has inputs (240 g of cider), a yield (40 g), and
consumers (15 g to the filling, 25 g to the glaze). The cider's mass and sugar
enter the dish once, through its consumers. Allocation lines are not
ingredients. They check that the consumers add up to the yield: 15 + 25 = 40.

**Today.** The allocation lines become ingredients:
`0 to taste · "about 2⅛ tsp for the apples"` and
`0 to taste · "about1tBsp + ½ tsp for the"`. Both references are
`no-food-match`. The trap from G1 applies here too. Alias
`apple cider reduction` to apple cider and 15 g of a 6:1 reduction would count
as 15 g of cider, a sixth of its sugar. The 240 g of raw cider would count as
well, once its stated grams are used (G11).

### G3 · A sub-recipe goes by different names

**Seen in** apple fritters. The section Cider Reduction is "Apple Cider
Reduction" in the filling and "Cider Reduction" in the glaze. The section
Milk Toasted Brown Butter is "Brown Butter" in the filling. Only the brown
butter line says `(from above)`.

**Goes wrong.** Exact names link one reference in three.

**Should.** Link a reference to a section when their head nouns agree
(reduction; brown butter), or when the line carries a marker: "from above",
"reserved", "prepared", "see below", "recipe follows".

**Today.** Nothing links a line to a section; there is no notion of a
reference.

### G4 · A sub-recipe's yield is not the sum of its inputs

**Seen in** apple fritters. 240 g of cider becomes 40 g, a 6:1 reduction, and
the recipe says so. 42 g of butter loses its water, about 16%, as it browns, and
the recipe states no yield.

**Goes wrong.** Summing a section's inputs overstates what reaches the dish by
200 g of evaporated water, and it misplaces concentration: the 15 g of reduction
in the filling carries the sugar of 90 g of cider.

**Should.** Use the stated yield where there is one, and an estimate marked as
an estimate where there is not.

**Today.** Not modelled; a section is the sum of its lines.

### G5 · Recipes have components, not one list

**Seen in** apple fritters: five sections. They are the dough, the cider
reduction, the brown butter, the filling and the glaze. Many recipes are a
main, a topping and a sauce.

**Goes wrong.** Flattened, the recipe loses which salt is which (dough 6 g,
filling 1.5 g, glaze 0.75 g), and dough can no longer be compared with dough
across recipes. A section header is a bare line, with no bullet and no quantity,
and is easily taken for an ingredient.

**Should.** Sections are the default structure; a single list is a recipe with
one section. Each section gets a role (dough, filling, glaze, sauce, topping),
read from its name. A section that others consume is a sub-recipe (G1–G4).

**Today.**
- `ExtractedRecipe.sections` exists, but only the spreadsheet importer
  (`personal-collection.ts`) fills it.
- `recipe-extract.ts` reads schema.org `recipeIngredient`, a flat list, so every
  fetched recipe arrives without sections.
- Comparing a whole recipe runs on the flat `ingredientLines`.
- A pasted section header parses as an ingredient:
  `0 to taste · "Yeasted Fritter Dough"`.

## Text

### G6 · A bullet is read as part of the number

**Seen in** apple fritters: every ingredient line opens with `•` (U+2022).

**Goes wrong.** The quantity pattern in `src/lib/ingredient-parser.ts` is
`[\d\s\/\-½-⅞\."]`, and `½-⅞` is not a list of fractions. It is the code-point
range U+00BD–U+215E. That range holds `•`, en and em dashes, curly quotes, most
accented letters, and all of Greek and Cyrillic. Only `∙` (U+2219) is stripped
as a bullet.

**Should.** Strip any leading bullet (•, ∙, ·, ▪, -, *) before parsing, and name
the fraction characters one by one instead of as a range.

**Today.** As pasted, every bulleted line parses to quantity `NaN`
(`NaN cups · "AP Flour"`) and nothing converts. The same range swallows an en
dash: `2–3 cloves garlic` gives `NaN clove`, while `2-3 cloves garlic` gives 2.
No line in `data/recipes/` is affected, because JSON-LD lines carry no bullets.
Any pasted or PDF recipe will be.

### G7 · ¼ is not read as a number

**Seen in** apple fritters: `¼ tsp (1.5g) Salt`, `¼ cup (60g) Apple Cider`.

**Goes wrong.** ¼ is U+00BC, one code point before ½, so the `½-⅞` range of G6
leaves it out.

**Should.** 0.25.

**Today.** `0 each · "¼ tsp (1.5g) Salt"`, unconvertible. All four ¼ lines
already in `data/recipes/` are broken. They are The Country Cook's
`¼ teaspoon black pepper` and `¼ teaspoon hot sauce ((optional))`, and The Modern
Proper's `¼ cup ketchup` and `¼ teaspoon freshly cracked black pepper`. The
ketchup matters: it is one of meatloaf's main sodium sources, so The Modern
Proper's salinity leaves out the ketchup's sodium.

### G8 · Lines wrapped mid-ingredient

**Seen in** apple fritters, copied from a PDF:
`• 1 cup (240g) Fresh Apple Cider,` / `unsweetened`, and
`• 2½ cups (375g) Granny Smith Apples` / `cutto ¼-inch (6mm) dice`.

**Should.** In a bulleted list, a line without a bullet that follows an item
belongs to that item, unless it reads as a section header (G5).

**Today.** `unsweetened`, `glaze` and `cutto ¼-inch dice` each become an
ingredient (`0 to taste`, unconvertible), and the first half keeps its comma:
`"Fresh Apple Cider,"`.

### G9 · A method step inside the ingredient list

**Seen in** apple fritters: `- Reduce to about 2 tBsp (40g total),`, with a dash
for a bullet, inside the cider reduction.

**Goes wrong.** It has a number, a unit and a mass, so it looks like an
ingredient. It is a step, and here it is also the sub-recipe's yield (G4).

**Should.** A line that opens with a cooking verb (reduce, whisk, divide, cook)
is a step. Keep what it states: "reduce to 40 g" is the yield.

**Today.** As pasted: `0 each · "reduce to about 2 tBsp ,"`, since the parser
takes the dash for the quantity. With the bullet stripped:
`0 to taste · "Reduce to about 2 tBsp ,"`. Unconvertible either way.

### G10 · Text damaged by PDF copying

**Seen in** apple fritters: `1tsp`, `1large`, `about1tBsp`, `cutto`, `tBsp`,
and the hedge `about`.

**Should.** Split a number glued to a word. Read `about`, `approximately` and
`~` as an "approximate" flag, not as part of the name.

**Today.**
- Handled: `1tsp` parses as `1 tsp`, `1large Egg` as `1 large`, and `tBsp` is
  lowercased to `tbsp`.
- Not handled: a line that opens with a word does not parse, so
  `about 2⅛ tsp (15g) for the apples` gives `0 to taste`. `cutto` stays in the
  name (G8).
- **Lowercasing has a cost.** Many cookbooks write `T` for tablespoon and `t`
  for teaspoon, and folding case makes them the same letter. `to-grams.ts` maps
  `t` to tsp, so `1 T butter` is read as a teaspoon, a threefold error. This is
  not in this recipe; it was found reading the code and confirmed by running it.

## Quantities

### G11 · Stated grams are thrown away

**Seen in** apple fritters: 27 of its 29 ingredient lines state their mass, for
example `3 cups (360g) AP Flour`.

**Goes wrong.** The recipe's own gram weight is the best figure there is. A
volume converted through USDA portions is an estimate, and a poor one for diced
fruit or packed sugar.

**Should.** When a line states a mass, use it, and convert the volume only when
it does not. Record which was used. The stated mass also settles what a volume
cannot: `1tsp (6g) Salt` is table salt, while a teaspoon of Diamond Crystal
kosher salt weighs about 3 g.

**Today.** The parser keeps `(360g)` as `alternateQuantity`, and nothing reads
it.
- `2½ cups (375g) Granny Smith Apples` converts to 272.5 g.
- `1 cup (240g) Fresh Apple Cider`, `1½ cups (225g) Honeycrisp Apples` and
  `2½ cups (300g) Confectioners’ Sugar` match the right food, find no cup
  portion, and get no grams at all.

### G12 · Decimal grams leak into the name

**Seen in** apple fritters: `⅛ tsp (0.25g) Nutmeg`, `1½ tsp (7.5g) Lemon Juice`,
`⅛ tsp (0.75g) Salt`, `½ tsp (2.5g) Vanilla Extract`.

**Goes wrong.** The pattern for a bracketed amount has no `.` in it, so `0.25g`
is not recognised as one.

**Today.** The bracket stays in the name: `0.125 tsp · "(0.25g) Nutmeg"` matches
*Oil, nutmeg butter*. The lemon juice, salt and vanilla lines still find their
food.

### G13 · Compound measures

**Seen in** apple fritters: `1tBsp + ½ tsp (25g) Cider Reduction`.

**Should.** Add them: 1 tbsp + ½ tsp is 3½ tsp. Better still, use the stated
25 g (G11).

**Today.** `1 tbsp · "+ ½ tsp Cider Reduction"`.

### G14 · A counted item with no weight

**Seen in** apple fritters: `1large Egg, room temp, beaten`, the only dough line
without grams.

**Should.** Use USDA's weight for a large egg (50 g), marked as an estimate.

**Today.** `1 large · "Egg, room temp, beaten"` matches *Egg substitute,
powder*, with no grams.

## Food matching

### G15 · Plain foods match the wrong USDA record

**Seen in** apple fritters, with the bullets stripped:

| Parsed name | Matched |
|---|---|
| `AP Flour` | *Carob flour* |
| `Sugar` | *Sugars, brown* |
| `Instant Yeast` | *Yeast extract spread* |
| `Whole Milk, lukewarm` | *Milk dessert, frozen, milk-fat free, chocolate* |
| `Egg, room temp, beaten` | *Egg substitute, powder* |
| `Whole Milk Powder` | *Protein supplement, milk based, Muscle Milk, powder* |
| `Cinnamon` | *Cinnamon buns, frosted (includes honey buns)* |
| `(0.25g) Nutmeg` | *Oil, nutmeg butter* |
| `Neutral Oil` | *Oil, oat* |
| `Bourbon` | no match |

**Goes wrong.** Search ranks a record that contains the word above the plain
food. "AP" is not known to mean all-purpose. The matcher also sees descriptors
such as "lukewarm" and "room temp, beaten" as part of the name.

**Should.** Alias the plain foods: `bun scripts/alias-worklist.ts` is the
existing route. Treat "AP" as all-purpose. Map a generic class ("neutral oil")
to a named default, and say so on the line.

### G16 · One food, several names, several components

**Seen in** apple fritters. Lemon juice appears as `Lemon Juice` (filling) and
`Fresh Lemon Juice` (glaze), and cider as `Fresh Apple Cider` and `Apple Cider`.
Salt is in the dough, the filling and the glaze; vanilla is in all three; butter
is in the dough and in the brown butter.

**Should.** One food whatever the adjective, since "fresh" is a condition and
not a different food. Keep each line in its own component for section
comparisons, and sum them for whole-recipe figures such as salinity. Never merge
lines across components.

**Today.** Both lemon juices resolve to *Lemon juice, raw*. The salts and
vanillas convert line by line, except the ¼ tsp salt (G7). Nothing is merged
across components.

---

## Prior art

*Checked 2026-09-26, against package registries, repositories and live demos.*

Is there a standard or library that already handles all of this? No.

- **Parsing one line** is close to solved.
- **Finding section headers** is half solved.
- **Linking a sub-recipe to its section** (G1–G4) is solved nowhere. Some
  formats can store "this ingredient is that section's output", but no parser
  infers it from free text. It is a relation between lines, and line parsers
  look at one line at a time.

| Tool | Covers here | Does not |
|---|---|---|
| [parse-ingredient](https://github.com/jakeboone02/parse-ingredient) · TypeScript · MIT · 3.0.0 | Unicode fractions glued to digits (G7).<br>`1tsp` and `tBsp` (G10).<br>`about`, with the `leadingQuantityPrefixes` option (G10).<br>`(360 g)` and a `+ ½ tsp` part, with `descriptionMeasurements` (G11, G13).<br>`isGroupHeader` for lines that start "For " or end with ":" (G5).<br>Its own tests run on `bun test`. | A glued `(360g)` stays in the description.<br>Bare headers such as `DOUGH` are not flagged.<br>`about1tBsp` and `cutto` are not repaired.<br>`1large` gives the unit "large". |
| [ingredient-parser](https://github.com/strangetom/ingredient-parser) · Python · MIT · 2.8.0 | A CRF model trained on about 81k labelled sentences.<br>Several amounts per line (G11), an "approximate" flag (G10), and `+`/`plus` composites (G13).<br>Size and preparation fields.<br>USDA FoodData Central ids (G15). | English only.<br>One line at a time.<br>No headers. |
| [recipe-scrapers](https://github.com/hhursev/recipe-scrapers) · Python · MIT, with a [TypeScript port](https://github.com/recipe-scrapers/recipe-scrapers) | `ingredient_groups()` reads each group's heading and lines from the page HTML, which keeps the groups JSON-LD drops (G5). | Only markup it knows (WP Recipe Maker, Tasty Recipes by default).<br>The TypeScript port has about 15 site scrapers. |
| [schema.org Recipe](https://schema.org/recipeIngredient) | Since 29.3, `recipeIngredient` may be a structured value ([#4454](https://github.com/schemaorg/schemaorg/issues/4454)). | No example of grouped ingredients, and Google's guidance still says plain text.<br>A recipe-as-ingredient proposal ([#4677](https://github.com/schemaorg/schemaorg/issues/4677)) was closed with a pointer to `hasPart`.<br>Expect a flat list (G5). |
| [Cooklang](https://github.com/cooklang/spec) | The nearest model for G1–G4:<br>• sections (`== Filling ==`);<br>• references to another recipe's output with an amount, `@./Cider Reduction{15%g}` against a declared `yield: 40%g` (experimental);<br>• in the Rust parser, references to a section's output. | A format you write recipes in, not a parser for free text. |

Mealie's data model gives each ingredient a section title and a
`referenced_recipe` (AGPL-3.0). It is a working example of the G1 model, not a
standard. The paid APIs (Zestful, Edamam, Spoonacular) parse one line at a
time, and none handles sub-recipes.

Regression data under permissive licences:
- [ingredient-parser's training sentences](https://github.com/strangetom/ingredient-parser/tree/master/train/data) (MIT)
- the NYT ingredient-phrase-tagger's 179,207 labelled lines (Apache-2.0, 2015)
- [TASTEset](https://github.com/taisti/TASTEset) (MIT, 700 ingredient lists)

RecipeNLG is for non-commercial research only.
