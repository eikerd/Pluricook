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
| San Francisco garlic noodles | Six recipes extracted from JSON-LD on 2026-09-30 (`bun scripts/extract-dish.ts garlic-noodles`); seven pages automation could not take, listed in `data/lookups/garlic-noodles.json`. | `data/recipes/garlic-noodles.json` |
| Picadillo | Jonathan Zaragoza, "The Ground Beef Recipe Everyone Makes Differently" (YouTube, `WCMJJLg5Pe8`), ingredient list pasted by the owner on 2026-10-05. Every line but one leads with its grams. | `data/fixtures/picadillo-zaragoza.txt` |
| Marry me chicken | Seven recipes extracted from JSON-LD on 2026-10-24 (`bun scripts/extract-dish.ts marry-me-chicken`); nine pages automation could not take, listed in `data/lookups/marry-me-chicken.json`. That Dude Can Cook's ingredient list (Sonny Hurrell, YouTube; video not on file), pasted by the owner the same day. | `data/recipes/marry-me-chicken.json`, `data/fixtures/marry-me-chicken-thatdudecancook.txt` |

## Index

| # | Gotcha | Kind | Today |
|---|---|---|---|
| G1 | A sub-recipe used as an ingredient | structure | unmatched |
| G2 | One sub-recipe feeds two components | structure | not modelled |
| G3 | A sub-recipe goes by different names | structure | not modelled |
| G4 | A sub-recipe's yield is not the sum of its inputs | structure | not modelled |
| G5 | Recipes have components, not one list | structure | partly |
| G6 | A bullet is read as part of the number | text | fixed |
| G7 | ¼ is not read as a number | text | fixed |
| G8 | Lines wrapped mid-ingredient | text | broken |
| G9 | A method step inside the ingredient list | text | broken |
| G10 | Text damaged by PDF copying | text | partly |
| G11 | Stated grams are thrown away | quantity | fixed |
| G12 | Decimal grams leak into the name | quantity | fixed |
| G13 | Compound measures | quantity | partly |
| G14 | A counted item with no weight | quantity | broken |
| G15 | Plain foods match the wrong USDA record | matching | partly |
| G16 | One food, several names, several components | matching | OK |
| G17 | Small weights rounded to a tenth of a gram | quantity | fixed |
| G18 | A second measure after a slash | quantity | fixed |
| G19 | A raw line break inside JSON-LD | text | fixed |
| G20 | One recipe, several publishers | structure | not modelled |
| G21 | Alternatives named in one line | matching | partly |
| G22 | Fresh and dry noodles on one anchor | quantity | worked around |
| G23 | A brand name in place of the food | matching | worked around |
| G24 | A bare count or a hedged measure in brackets stays in the name | text | fixed |
| G25 | Dried chiles named by variety | matching | worked around |
| G26 | A regional name USDA lacks | matching | worked around |
| G27 | The comma after a food's first word is dropped | text | fixed |
| G28 | Taking out the count noun cuts the name mid-word | text | fixed |
| G29 | A counted chicken breast has no weight | quantity | fixed |
| G30 | A cup of cream read as whipped | quantity | fixed |
| G31 | A container's net weight is thrown away | quantity | fixed |
| G32 | A metric conversion with no slash or bracket | text | fixed |
| G33 | The markup disagrees with the page | structure | partly |
| G34 | A spice blend USDA has no record for | matching | broken |
| G35 | An alias misses a food followed by its preparation | matching | fixed |
| G36 | USDA's portion is in the plural | quantity | fixed |

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
`0 to taste · "about1tBsp + ½ tsp for the"`. Both references now carry their
stated 15 g and 25 g (G11), but no food is found for either name, so they still
land in Unmatched lines. The trap from G1 applies here too. Alias
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

### G20 · One recipe, several publishers

**Seen in** the garlic noodles search. J. Kenji López-Alt's recipe is on NYT
Cooking, and the search snippets for Leite's Culinaria and willdonovan.com open
with the same lines word for word: `4 tablespoons unsalted butter`,
`20 medium garlic cloves, minced or smashed in a mortar and pestle`,
`4 teaspoons oyster sauce`. Joshua Weissman's is "Adapted from *The Wok*" by
the same author.

**Goes wrong.** Each copy would count as an independent recipe, so one
author's quantities would be counted three times in every consensus frequency,
median and spread.

**Should.** Notice near-identical ingredient lists across hosts, count them
once, and credit the original. An adaptation is a separate recipe.

**Today.** Not modelled. Nothing double-counted this run, but only by luck: NYT
was skipped by policy, Leite's refused (HTTP 403), and willdonovan.com has no
JSON-LD.

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

**Fixed 2026-09-27.**
- The fractions are listed one by one (`VULGAR` in `ingredient-parser.ts`).
- A leading bullet is stripped.
- An en-dash range reads as its first figure.

`• 3 cups (360g) AP Flour` now parses as `3 cups`. Tests: "G6: …" in
`ingredient-line.test.ts`. Before the fix, every bulleted line parsed to
quantity `NaN`, and so did `2–3 cloves garlic`.

### G7 · ¼ is not read as a number

**Seen in** apple fritters: `¼ tsp (1.5g) Salt`, `¼ cup (60g) Apple Cider`.

**Goes wrong.** ¼ is U+00BC, one code point before ½, so the `½-⅞` range of G6
leaves it out.

**Should.** 0.25.

**Fixed 2026-09-27**, by the same change as G6. `¼ tsp (1.5g) Salt` now parses
as `0.25 tsp`.

All four ¼ lines in `data/recipes/` now resolve: The Country Cook's black pepper
and hot sauce, and The Modern Proper's ketchup and black pepper. With its
ketchup counted, The Modern Proper's meatloaf salinity rises from 1.96 to 2.11,
and the corpus median from 1.87 to 1.88.

Tests: "G7: …" in `ingredient-line.test.ts` and `compare.test.ts`.

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

**Today.** `0 to taste · "Reduce to about 2 tBsp ,"`, unconvertible. Until the G6
fix, the parser also took the dash for the quantity.

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

### G19 · A raw line break inside JSON-LD

**Seen in** Joshua Weissman's garlic noodles page, whose only JSON-LD block
has a literal line break inside the `description` string.

**Goes wrong.** Strict JSON forbids a raw control character inside a string, so
`JSON.parse` rejected the page's only block and it was reported as
`unparseable-json-ld`. Browsers and search engines accept the same block.

**Should.** Retry once with control characters escaped inside string literals,
leaving whitespace between tokens alone.

**Fixed 2026-09-30.** The block parses, and the page now reports the real
problem, `no-ingredients`: its Recipe node carries no ingredient list (the
lines are only in the page's HTML). The same fix recovered one of Chef Tu's
three broken blocks.

Test: "G19: …" in `recipe-extract.test.ts`.

### G24 · A bare count or a hedged measure in brackets stays in the name

**Seen in** picadillo: `20 g (1) ancho chile, stemmed and seeded` (also pasilla
and guajillo), `12 g (about 2 1/2 tsp) worcestershire sauce`,
`35 g (about 1/4 cup) castelvetrano olives, pitted and chopped`.

**Goes wrong.** A bracketed amount was read only when a unit word followed the
digits straight away. `(1)` has no unit and `(about …)` opens with a word, so
both stayed in the name: `(1) ancho chile, …`. Matching drops brackets, so the
foods were unaffected. The name shown was wrong, and a hedged gram figure,
`(about 120g)`, was never taken as stated.

**Should.** Take both out of the name. A bare count is kept as an alternate in
`each`, a cross-check on the mass beside it. A hedge word (about, approx.,
approximately, roughly, around, ~) is dropped before the amount is read, but
only when what follows it is an amount: `(about a pound)` stays in the name.

**Fixed 2026-10-05.** Rules `parse:bracketed-count` and `parse:bracketed-hedge`
in `ingredient-parser.ts`. Removing the bracket from `2 leeks (approx. 6 oz),
white and pale green parts only` and `5 celery stalks (approx. 6 oz) (small
dice)` (lentil soup) exposed G27 and G28. Those two already broke every line
whose bracketed amount was taken out, hedged or not.

Tests: "G24: …" in `ingredient-line.test.ts`.

### G27 · The comma after a food's first word is dropped

**Seen in** lentil soup: `2 leeks (approx. 6 oz), white and pale green parts
only, …`. It also affects any line shaped like `2 onions, chopped`.

**Goes wrong.** The parser reads the first word after the number as a unit.
For `2 onions, chopped` that gives `onions` as the unit and `, chopped` as the
name. The leading comma was stripped, and the unknown "unit" was put back
in front of the name, giving `onions chopped`. Matching splits on the first
comma, so it searched `onions chopped`. Once G24 took the leeks' bracket out,
they searched `leeks white and pale green parts only` and found *Quail, meat
only, raw*. Only the leeks changed result in the edge-case table, because most
names still match on their first word.

**Should.** Put the comma back between the food and what follows it:
`onions, chopped`.

**Fixed 2026-10-05.** Rule `line:comma-after-food` in `ingredient-line.ts`.

Tests: "G27: …" in `ingredient-line.test.ts`.

### G28 · Taking out the count noun cuts the name mid-word

**Seen in** lentil soup: `5 celery stalks (approx. 6 oz) (small dice)` and
`2 garlic cloves (minced)`. It also affects every counted line with a bracket
before its first comma.

**Goes wrong.** `line:count-noun-from-name` finds the count noun ("stalks",
"cloves") in the name with its brackets blanked out. It blanked each bracket
to a single space, then cut the real name at an offset measured in the blanked
one. `celery stalks (small dice)` became `celerysmall dice)`. `garlic
(minced)` matched nothing, so every `N garlic cloves (minced)` line in the
corpus had no grams.

**Should.** Blank a bracket to spaces of its own length, so the offsets agree,
and take only the count noun out.

**Fixed 2026-10-05**, in the same rule. Now resolved: five garlic lines across
lentil soup and meatloaf, at 6 g and 9 g; A Beautiful Plate's celery, at 200 g;
and RecipeTin Eats' `2 beef bouillon cubes (…)` (meatloaf), which had matched
*Sugars, powdered*.

Tests: "G28: …" in `ingredient-line.test.ts`.

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

**Fixed 2026-09-27.** `parseLine` returns `statedGrams`, and `conversionInput`
makes every caller of `toGrams` use it: `compare.ts`, `probe-lines`,
`gram-coverage` and `alias-worklist`. Only metric masses count, because
`(8 oz)` is as often fluid ounces as weight.
- `2½ cups (375g) Granny Smith Apples` now converts to 375 g; it was 272.5 g.
- The apple cider, Honeycrisp and confectioners' sugar lines had no grams at
  all. They now take their stated 240, 225 and 300 g.

Tests: "G11: …" in `ingredient-line.test.ts` and `compare.test.ts`.

### G12 · Decimal grams leak into the name

**Seen in** apple fritters: `⅛ tsp (0.25g) Nutmeg`, `1½ tsp (7.5g) Lemon Juice`,
`⅛ tsp (0.75g) Salt`, `½ tsp (2.5g) Vanilla Extract`.

**Goes wrong.** The pattern for a bracketed amount has no `.` in it, so `0.25g`
is not recognised as one.

**Fixed 2026-09-27**, with G11: the bracketed-amount pattern accepts decimals.
`⅛ tsp (0.25g) Nutmeg` now gives the name `Nutmeg` and a stated 0.25 g. It still
matches *Oil, nutmeg butter* (G15), and it is rounded to 0.3 g (G17).

### G13 · Compound measures

**Seen in** apple fritters: `1tBsp + ½ tsp (25g) Cider Reduction`.

**Should.** Add them: 1 tbsp + ½ tsp is 3½ tsp. Better still, use the stated
25 g (G11).

**Today.** `1 tbsp · "+ ½ tsp Cider Reduction"`. The stated 25 g now carries the
amount (G11), but `+ ½ tsp` is still in the name. A line with no stated mass
would still lose the ½ tsp.

### G14 · A counted item with no weight

**Seen in** apple fritters: `1large Egg, room temp, beaten`, the only dough line
without grams.

**Should.** Use USDA's weight for a large egg (50 g), marked as an estimate.

**Today.** `1 large · "Egg, room temp, beaten"` matches *Egg substitute,
powder*, with no grams.

**Seen again in** picadillo, 2026-10-05: `2 fresh bay leaves` parses as
`2 leaf · "fresh bay"` and matches *Spices, bay leaf*, with no grams. USDA
publishes only `1 tsp, crumbled = 0.6 g` for it, and that is the dried leaf,
not the fresh one. It is the only line of eighteen without grams.

### G17 · Small weights rounded to a tenth of a gram

**Seen in** apple fritters: `⅛ tsp (0.25g) Nutmeg`, `⅛ tsp (0.75g) Salt`.

**Goes wrong.** `toGrams` rounds every result to 0.1 g. So 0.25 g of nutmeg
becomes 0.3 g, 20% more, and 0.75 g of salt becomes 0.8 g. Spices and salt are
the lines where that matters, and salinity is computed from the salt.

**Should.** Keep a stated figure as written, and round a conversion to 0.01 g.

**Today.** 0.25 g gives `0.3`, and 0.75 g gives `0.8`. Found once G11 let the
stated grams through.

**Fixed 2026-10-05**, when the picadillo's `0.75 g (1/2 tsp) whole cumin seeds`
came out as 0.8 g. Both stated grams and a line that leads with grams reach
`toGrams` as a mass, so the fix is in its first step: a mass is rounded to
0.01 g (rule `line:hundredth-gram`). 0.25 g of nutmeg and 0.75 g of cumin now
stay exact. Pounds and ounces move by the same hundredth: 2 lb is 907.18 g, was
907.2. Volume conversions still round to 0.1 g; USDA's portions are not more
precise than that. `probe-lines.ts` printed every figure to one decimal too,
which hid the fix; it now prints the figure as is.

Tests: "G17: …" in `to-grams.test.ts`.

### G22 · Fresh and dry noodles on one anchor

**Seen in** garlic noodles: `20 oz. , Sun Noodle, Kaedama`,
`14 - 20 oz. fresh pre-cooked chow mein noodles` and
`14-16 oz package of fresh egg noodles` beside `1 pound dried spaghetti`.

**Goes wrong.** The dish anchors on grain, and every other line is measured as
a percentage of the grain's mass. A pound of fresh noodles holds much less
flour than a pound of dry, so recipes using fresh noodles read as lighter on
everything else. USDA has no fresh wheat-noodle record, and the fresh lines
match *Noodles, chinese, chow mein*, which is fried at 1.6% water. Dry pasta is
9.9% and cooked egg noodles are 67.7%.

**Should.** Anchor on a dry-equivalent mass: convert a fresh or cooked form by
its water content, from a record that states one.

**Worked around 2026-09-30**, at the owner's word: "go ahead and change it to
a dry noodle, but make a note that you had to do that." Fresh noodles are a
*form* in `data/ingredients/not-in-usda.json`, counted as the dry record by dry
matter: grams × (100 − 31.0) / (100 − 9.9) = 0.77, from *Pasta,
fresh-refrigerated, plain, as purchased* and *Pasta, dry, enriched*. Fresh egg
noodles count as *Noodles, egg, dry, enriched*. Each converted line carries
basis `counted-as-dry` and says so. Only a stated mass converts; a cup of fresh
noodles is refused.

It is a workaround, not a fix. Steamed, pre-cooked noodles hold more water
than raw fresh ones, so their dry figure is high. Sodium now follows the dry
record, 6 mg per 100 g, so noodles salted in the dough read low. Before, the
fried chow mein match at 866 mg per 100 g read far higher: Chef Tu's 20 oz of
fresh ramen alone carried about 4,900 mg of sodium that is not in the recipe.

Tests: "a form USDA lacks — fresh noodles counted as dry (G22)" in
`not-in-usda.test.ts`.

## Food matching

### G18 · A second measure after a slash

**Seen in** RecipeTin Eats: `2 cups / 400g dried lentils` and
`400g / 14 oz crushed tomato` (lentil soup), `1 kg / 2 lb ground beef (mince)`
(meatloaf), in `data/recipes/`.

**Goes wrong.** Only a bracketed alternate was recognised, so the measure after
the slash stayed in the name (`400g dried lentils`, `2 lb ground beef`), and a
metric mass there was never used: the two cups of lentils converted through
USDA's cup, to 384 g, instead of the stated 400 g.

**Should.** Read a measure after the slash as the line's alternate, as a
bracketed one is: it leaves the name, and a metric mass becomes the line's
stated weight (G11). A slash with no measure after it is left alone.

**Fixed 2026-09-29**, found by Codex in the first review round of PR #3. The
lentils convert at the stated 400 g and match *Lentils, dry*, which puts
RecipeTin Eats' lentil soup at 56 mg of sodium where it read 79. The beef and
tomato lines lose the second measure from their names and match as before.

Tests: "G18: …" in `ingredient-line.test.ts`.

### G15 · Plain foods match the wrong USDA record

**Seen in** apple fritters. First seen 2026-09-26; updated 2026-09-27, after G11:

| Parsed name | Matched now | Matched before G11 |
|---|---|---|
| `AP Flour` | *Flour, 00* | *Carob flour* |
| `Sugar` | *Sugars, granulated* ✓ | *Sugars, brown* |
| `Instant Yeast` | *Yeast extract spread* | same |
| `Whole Milk, lukewarm` | *Milk, whole, 3.25% milkfat* ✓ | *Milk dessert, frozen, milk-fat free, chocolate* |
| `Egg, room temp, beaten` | *Egg substitute, powder* | same |
| `Whole Milk Powder` | *Protein supplement, milk based, Muscle Milk, powder* | same |
| `Cinnamon` | *Cinnamon buns, frosted (includes honey buns)* | same |
| `Nutmeg` | *Oil, nutmeg butter* | same |
| `Neutral Oil` | *Oil, corn* | *Oil, oat* |
| `Bourbon`, `Apple Cider Reduction` | no match | same |

Three matches came right as a side effect of G11. A line that needs a
household measure makes `matchFood` consider only foods that publish one. A
line with a stated mass needs none, so the whole search is open to it.

**Goes wrong.** Search ranks a record that contains the word above the plain
food. "AP" is not known to mean all-purpose. The matcher also sees descriptors
such as "lukewarm" and "room temp, beaten" as part of the name.

**Should.** Alias the plain foods: `bun scripts/alias-worklist.ts` is the
existing route. Treat "AP" as all-purpose. Map a generic class ("neutral oil")
to a named default, and say so on the line.

**Seen again in** garlic noodles, 2026-09-30. The same mechanism: a line with
a household measure considers only records that publish one, so the plain
record loses to a cousin that does.

| Line as published | Matched before | Now (alias) |
|---|---|---|
| `1 tbsp sugar` | *Sugars, brown* | *Sugars, granulated* |
| `⅓ cup Parmesan cheese` | *Cheese, parmesan, hard*, no weight | *Cheese, parmesan, grated* |
| `1/4 cup Parmigiano Reggiano (freshly grated)` | no match | *Cheese, parmesan, grated* |
| `1 tablespoon neutral oil` | *Oil, oat* | *Oil, canola* |
| `1 tsp crushed red pepper flakes ((optional) )` | *Onions, dehydrated flakes* | *Spices, pepper, red or cayenne* |
| `1 cup pasta or noodle water` | *Water convolvulus, raw* (a leafy green) | *Beverages, water, tap, drinking* |
| `1 pound dried spaghetti, dried thin Chinese wheat noodles, …` | *Spaghetti, spinach, dry* | *Pasta, dry, enriched* |

Each is a golden case in `data/ingredients/expectations.json`.

**Seen again in** picadillo, 2026-10-05. Each of these lines states its grams,
so the whole search was open to it, and the fallback search drops words the
index lacks:

| Line as published | Matched before | Now (pattern) |
|---|---|---|
| `125 g (1 medium) carrot, peeled and small dice` | *Carrots, baby, raw* | *Carrots, raw* |
| `230 g (2 small) yukon gold potatoes, …` | *Potatoes, red, without skin, raw* | *Potatoes, gold, without skin, raw* |
| `35 g (about 1/4 cup) castelvetrano olives, …` | *Olives, green, Manzanilla, stuffed with pimiento* | *Olives, pickled, canned or bottled, green* |

"yukon" and "castelvetrano" are not in the index, so the search fell back to
"potatoes" and "olives" alone. A `baby carrot` pattern keeps baby carrots off
the plain one. Each is a golden case.

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

**Seen again in** garlic noodles: `green onions` reached *Onions, young green,
tops only* while `scallion` reached *Onions, spring or scallions*, so the one
food sat in two records and missed the consensus. Aliased 2026-09-30; scallions
now count in 4 of 6 recipes.

### G21 · Alternatives named in one line

**Seen in** garlic noodles: `½ pound spaghetti or egg noodles`,
`1 lb ramen, spaghetti, egg noodles or lo mein (cooked al dente)`,
`2 tablespoon unsalted or salted butter`,
`1/2 cup unsalted butter or neutral flavor cooking oil`,
`¼ cup, Chives or Scallion, sliced`.

**Goes wrong.** The whole list goes to search, and whichever word ranks
highest wins: `ramen, spaghetti, …` reached *Ramen bowl, NFS*, and `unsalted
or salted butter` reached *Butter, salted*.

**Should.** Take the first-named alternative as the line's food and keep the
others as alternates, as a bracketed or slashed measure is kept (G18).

**Today.** Partly. The `spaghetti` alias catches the two noodle lines;
`unsalted or salted butter` still matches *Butter, salted*.

### G23 · A brand name in place of the food

**Seen in** garlic noodles: `1 tbsp, Son Fish Sauce`, `Sun Noodle, Kaedama`,
`2 teaspoons maggi seasoning`.

**Goes wrong.** The brand word steers the search: Son Fish Sauce reached
*Sauce, barbecue*, and Maggi reached *Seasoning mix, dry, taco, original*.
Maggi Seasoning has no USDA record at all.

**Should.** Alias a brand to its generic food. For a brand with no USDA
counterpart, record the stand-in chosen and its reason, or leave the line
unresolved rather than invent a match.

**Worked around 2026-09-30.** Fish sauce and Sun Noodle are aliased. Maggi is
the first *food* in `data/ingredients/not-in-usda.json`, the owner's "own table
of things that just apparently aren't in USDA".

Maggi is in fact in USDA, in Branded Foods: fdc 2755366, the US 6.7 fl oz
bottle, 8,600 mg of sodium per 100 mL. We do not load Branded Foods; we load
Foundation, SR Legacy and FNDDS. The entry cites that record and takes soy
sauce's density, which it says it assumed. A line with Maggi now converts with
basis `not-in-usda`.

Tests: "a food USDA lacks — Maggi Seasoning" in `not-in-usda.test.ts`.

---

### G25 · Dried chiles named by variety

**Seen in** picadillo: `20 g (1) ancho chile, stemmed and seeded`,
`7 g (1) pasilla chile, …`, `5 g (1) guajillo chile, …`.

**Goes wrong.** USDA files chiles under "Peppers". "ancho chile" found no
record holding both words, so the search fell back to "chile" alone and matched
the survey dish *Chiles rellenos, cheese-filled* for all three.

**Should.** Match each variety to its dried record. Where USDA has none, use a
named stand-in and say so.

**Worked around 2026-10-05** with patterns:
- `ancho chile` (and `ancho chili`) → *Peppers, ancho, dried*. Bare "ancho"
  would also catch "anchovy".
- `pasilla` → *Peppers, pasilla, dried*. USDA's 7 g per pepper matches the
  recipe's.
- `guajillo` → *Peppers, hot chile, sun-dried*, marked STAND-IN in its note.
  USDA has no guajillo.

The general fix, reading "chile" as "peppers" when searching, is not built.

### G26 · A regional name USDA lacks

**Seen in** picadillo: `1.4 g (1/4 tsp) ground canela`,
`0.5 g (1/2 tsp) mexican oregano`.

**Goes wrong.** Canela matched nothing. Its mass was exact, but the line
dropped out of every food comparison. Mexican oregano matched *Spices,
oregano, dried*, a different plant, and nothing on the line said so.

**Should.** Map each to its nearest record and say what was assumed.

**Worked around 2026-10-05** with patterns:
- `canela` → *Spices, cinnamon, ground*. USDA does not separate Ceylon from
  cassia.
- `mexican oregano` → *Spices, oregano, dried*, marked STAND-IN.

`probe-lines.ts` used to print the basis where the food goes, which hid the
miss. It now prints the line's note: `mass exact; food not identified`.

### G29 · A counted chicken breast has no weight

**Seen in** marry me chicken, 2026-10-24: `4 boneless, skinless chicken
breasts` (Delish, Simply Organic, The Modern Proper), `4 chicken breasts` (BBC
Good Food), `2 chicken breasts` (Andy Cooks).

**Goes wrong.** Two misses in a row. The search took "boneless" for the food
and reached *Pork, fresh, loin, blade (chops), boneless*; "chicken breasts"
reached *Chicken breast, roll, oven-roasted*, a deli meat. The one line that
did reach raw breast (12 Tomatoes) still got no grams: SR Legacy weighs a breast
as `1 piece = 272 g`, and "piece" was not on the list of whole-item portions.
The backbone of the dish converted in none of eight recipes, and the comparison
anchored on dairy.

**Should.** Raw boneless skinless breast, 272 g each, from USDA's own portion.

**Fixed 2026-10-24.** A `chicken breast` pattern pins *Chicken, broiler or
fryers, breast, skinless, boneless, meat only, raw* (171077), and a portion
named "piece" counts as one whole item (`line:piece-is-whole`). Four breasts
come to 1,088 g; The Modern Proper's own "about 2 pounds" is 907 g, so USDA's
breast runs large. The comparison now anchors on meat.

Tests: "G29: a counted chicken breast weighs USDA's one piece" in
`to-grams.test.ts`; golden cases in `expectations.json`.

### G30 · A cup of cream read as whipped

**Seen in** marry me chicken: `1/2 c. heavy cream` (Delish), `2/3 cup heavy
cream`, `150ml double cream`.

**Goes wrong.** USDA lists two cups for *Cream, fluid, heavy whipping*: `cup,
whipped = 120 g` first, `cup, fluid (yields 2 cups whipped) = 238 g` second.
The first was taken, so half a cup of cream weighed 60 g, half of what it does.

**Should.** A recipe that does not say whipped means poured cream.

**Fixed 2026-10-24** (`line:poured-not-whipped`). A portion that says
whipped, outside its brackets, is passed over unless the line says whip; the
scaled path (ml from the cup) does the same. ½ cup is now 119 g.

Tests: "G30: a cup of heavy cream is poured, not whipped" and "G30: a recipe
that says whipped still gets the whipped cup" in `to-grams.test.ts`.

### G31 · A container's net weight is thrown away

**Seen in** marry me chicken: `1 (7-ounce) jar sun-dried tomatoes, drained and
roughly chopped` (The Modern Proper).

**Goes wrong.** The bracket was read as an ounce alternate and dropped, since
"(8 oz)" in brackets is as often fluid ounces. "jar" became part of the name, so
the line matched *Tomatoes, red, ripe, canned* and weighed whatever one
"medium" portion of that came to: 111 g.

**Should.** "1 (7-ounce) jar" is 7 oz on the label: 198 g.

**Fixed 2026-10-24** (`line:container-net-weight`). A count of a container
(jar, can, tin, package, packet, bag, box, carton, tub, bottle) with a
hyphenated size in brackets weighs count × size. A bare `(8 oz)` is still not
trusted. The jar is weighed before draining, so the line overstates the
tomatoes by their oil.

Tests: "G31: …" in `ingredient-line.test.ts`.

### G32 · A metric conversion with no slash or bracket

**Seen in** marry me chicken: `¾ cup 177 ml chicken stock`, `¼ cup 25 g
Parmesan cheese, grated`, `⅓ cup 18 g sun-dried tomatoes` (Sweet y Salado, a
WP Recipe Maker card with its unit conversion printed inline).

**Goes wrong.** "177 ml chicken stock" was taken as the name, so the exact
`chicken stock` alias missed and the line reached *Soup, stock, beef,
home-prepared*. The 25 g and 18 g were never used as the line's own weighing.

**Should.** Read the second measure as an alternate, as G18 does after a
slash.

**Fixed 2026-10-24** (`parse:bare-alternate`). A metric measure straight
after the first one leaves the name; a gram figure becomes the stated grams.
Only metric units qualify, so `1 cup 2% milk` keeps its name.

Tests: "G32: …" in `ingredient-line.test.ts`.

### G33 · The markup disagrees with the page

**Seen in** marry me chicken: Kikkoman's JSON-LD gives `"recipeIngredient":
["Chicken"]` while the page lists fourteen lines; Sweet y Salado's gives `4
boneless` where its page says boneless, skinless chicken breasts.

**Goes wrong.** Kikkoman entered the corpus as a one-ingredient recipe and
counted against every consensus line. Sweet y Salado's breasts reached pork,
with no grams.

**Should.** A one-line recipe is no recipe: send the page to a person.
A truncated line cannot be repaired from the markup alone.

**Today.** Partly. One line is now a failure, `one-ingredient`
(`extract:one-line-is-no-recipe`), and Kikkoman is on the look-up list. `4
boneless` is still in the corpus, unconverted.

Tests: "G33: one ingredient line is not a recipe" in `recipe-extract.test.ts`.

### G34 · A spice blend USDA has no record for

**Seen in** marry me chicken: `1 teaspoon Italian seasoning` (The Modern
Proper), `1 1/2 teaspoons Simply Organic® Italian Seasoning`.

**Goes wrong.** Both reached *Seasoning mix, dry, taco, original*, the record
Maggi reached before G23's fix. Taco seasoning is salted; Italian seasoning is
dried herbs. Two of seven recipes now share a wrong food.

**Should.** A spec in `not-in-usda.json` citing a Branded Foods record, as
Maggi has, or no match rather than a wrong one.

**Today.** Broken; not fixed in this run.

### G35 · An alias misses a food followed by its preparation

**Seen in** marry me chicken, That Dude Can Cook's paste: `1/2 yellow onion
diced`. Then, by the edge-case replay, across three older dishes: `1 yellow
onion, chopped` (lentil soup), `2 large eggs, beaten` (meatloaf, three
recipes), `• 1large Egg, room temp, beaten` (apple fritters).

**Goes wrong.** An exact alias matches the whole name only. `yellow onion` and
`eggs` are exact aliases, but the names were `yellow onion diced` and `eggs,
beaten`, so the search ran instead: the onions reached *Onions, yellow,
sauteed* and the eggs *Eggs, scrambled, frozen mixture*, both with no grams.
The paste's onion had no comma at all, so the preparation looked like part of
the food.

**Should.** Try the exact alias on the food before its preparation.

**Fixed 2026-10-24**, with two rules. `line:trailing-preparation` sets a
trailing preparation word (and an adverb before it, "finely chopped") apart
with a comma, when the name has no comma of its own. `line:alias-before-comma`
tries an exact alias on the name before its first comma. Eleven lines in four
dishes now convert: eggs at 50 g each, a yellow onion at 110 g. A food named by
its preparation ("crushed tomatoes") is untouched, since only trailing words
move.

Tests: "G35: …" in `ingredient-line.test.ts`; the onion is a golden case.

### G36 · USDA's portion is in the plural

**Seen in** marry me chicken, That Dude Can Cook: `12-14 basil leaves`.

**Goes wrong.** The line counts "leaf"; USDA writes *Basil, fresh* as `5 leaves
= 2.5 g`. The portion matcher looked for the word "leaf" and found none, so the
basil had no weight.

**Should.** 12 leaves at 0.5 g each: 6 g.

**Fixed 2026-10-24** (`line:plural-portion`). A count unit also matches its
plural in a portion's wording ("leaves" for leaf, an added "s" otherwise).

Tests: "G36: a counted leaf finds USDA's portion written in the plural" in
`to-grams.test.ts`.

Also from this paste: `1/2 cup dry white wine` reached *Wine cooler* and `2 tsp
Dijon mustard` reached *Mustard greens, raw* (the bare-mustard miss PR #5's
note listed). Both are aliased: white wine → *Alcoholic beverage, wine, table,
white*; dijon → *Mustard, prepared, yellow*, marked STAND-IN, since USDA has no
Dijon. The meatloaf's `1 tbsp. Dijon mustard` now converts too.

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

Cooklang was considered as Pluricook's own format and not adopted for now. The
decision, and what we take from it, is in `docs/recipe-format.md`.

Mealie's data model gives each ingredient a section title and a
`referenced_recipe` (AGPL-3.0). It is a working example of the G1 model, not a
standard. The paid APIs (Zestful, Edamam, Spoonacular) parse one line at a
time, and none handles sub-recipes.

Regression data under permissive licences:
- [ingredient-parser's training sentences](https://github.com/strangetom/ingredient-parser/tree/master/train/data) (MIT)
- the NYT ingredient-phrase-tagger's 179,207 labelled lines (Apache-2.0, 2015)
- [TASTEset](https://github.com/taisti/TASTEset) (MIT, 700 ingredient lists)

RecipeNLG is for non-commercial research only.
