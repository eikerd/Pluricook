# Recipe format: design notes

Pluricook has no recipe format of its own yet. `ExtractedRecipe`
(`src/types/provenance.ts`) holds the lines as published, and its `sections`
field is optional. These notes collect what a real format has to do, so that
its design starts from them. The cases come from the gotchas log
(`docs/recipe-gotchas.md`), and entries here cite its numbers.

## Cooklang: considered 2026-09-26, not adopted

[Cooklang](https://cooklang.org/docs/spec/) is a plain-text recipe language:
- Each paragraph is a step.
- Ingredients are marked inside the steps: `@bacon strips{1%kg}`.
- Sections are `== Filling ==`.
- A recipe can use another recipe as an ingredient:
  `@./sauces/Hollandaise{150%g}`.

**Decision.** The owner: "it doesn't yet seem like worth the trouble at this
point." We keep our own format and take Cooklang's lessons.

**Why not, in short.**
- **Its unit is the method step.** Ingredients exist only inside steps, but
  Pluricook stores facts and never a publisher's step wording. A faithful
  `.cook` file of a published recipe is the one thing we must not keep.
- **It is where parsing ends up, not a parser.** Every gotcha in the log happens
  on the way into it.
- **One amount per ingredient**, so `3 cups (360g)` cannot keep both.
- **Its sub-recipe and provenance support does not fit.**
  - Provenance would be free-form YAML front matter.
  - In the core spec a sub-recipe is a separate file.
  - Referencing a section of the same file is a parser extension, and scaling
    by yield is experimental.
  - The TypeScript package is pre-1.0 (0.18.7).
- **It knows nothing about food.** It has no USDA matching, no densities and no
  salinity.

**Revisit if** the owner starts writing their own recipes as text. Cooklang
suits recipes whose method is ours to keep. It would come in as an importer
beside the spreadsheet one, not as the store.

## What we take from it

1. **Sections are the structure, and a single list is one section.** Today
   `ingredientLines` is primary and `sections` optional. Turn that round: every
   recipe has at least one section, and the flat list is derived from them.
   (G5)
2. **A reference is an ingredient whose food is another section's output.** It
   carries its own amount. In `@./Cider Reduction{15%g}` the line says how much
   of the output it uses. (G1, G2)
3. **A sub-recipe has a yield, and each reference takes a share of it.**
   Cooklang scales a referenced recipe by amount ÷ yield (experimental).
   - For us, the filling's 15 g of reduction is 15/40 of the cider reduction's
     inputs, which is 90 g of cider. Counting inputs by share is how a
     sub-recipe gets counted exactly once.
   - Allocation lines ("15 g for the apples") are not ingredients. They are a
     check that the shares add up to the yield.
   - When there is no stated yield, as with the brown butter, it is estimated
     and marked as an estimate. (G2, G4)
4. **Amount, name and note are separate fields.** In
   `@onion{1}(peeled and finely chopped)` the note never enters the name. For
   us, "lukewarm", "room temp, beaten", "softened" and "cut to ¼-inch dice" go
   to the note, and matching sees the name alone. (G15)
5. **Facts inside the method are data.** Cooklang marks timers and cookware
   inside its steps. We do not keep step wording, but a fact inside a step is
   ours to keep. "Reduce to about 2 tBsp (40g total)" is the reduction's yield:
   keep the fact and drop the words. (G9)

## What we do differently

1. **Keep the line as published, and derive the parse from it.** Cooklang's text
   is the source of truth because its author wrote it. Ours is someone else's
   text, read by a parser that is still improving. So store the raw line and the
   parse beside it, and re-run the parse when the parser improves.
2. **Several amounts per line, one of them authoritative.** `3 cups (360g)`
   gives two amounts: 3 cups and a stated 360 g. The stated mass wins, and the
   volume is the cross-check. (G11)
3. **A sub-recipe stays inside its recipe.** Cooklang's core reference is a file
   path. A published recipe's reduction shares that recipe's source and credit,
   so it is a section referenced by id, not a file of its own.
4. **Resolved references are stored, not re-guessed.** A Cooklang author writes
   each reference out. We infer ours, from markers such as "from above" and from
   shared words such as "reduction" (G3). Store each resolution with its reason
   and let the owner correct it, the way the alias table records food matches.
5. **Provenance stays typed and required.** It is not free-form front matter:
   `assertProvenance` keeps its rule that a recipe without a source is not
   stored.
6. **Units come from a closed list, and the token as written is kept.**
   Cooklang's unit is free text. Ours normalizes the unit but keeps what the
   recipe wrote, so the `T`/`t` question can be settled later. (G10)
