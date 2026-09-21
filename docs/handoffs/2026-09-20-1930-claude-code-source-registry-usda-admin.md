---
tool: claude-code
model: Fable 5.1, then Opus 5
repo: eikerd/Pluricook
branch: workflow-source-registry
pr: https://github.com/eikerd/Pluricook/pull/1
state: merged
deployed: no
loose-ends: round-3 fixes (514f12c) merged UNREVIEWED; CodeRabbit never completed a review; 16 pre-existing type errors in ingredient-parser and unit-normalizer; dead scaffold files (App.tsx, APITester.tsx); TODO.md stale; comparison not in the admin UI and not section-aware; microdata/HTML/LLM extraction tiers not built; 3 todo matcher tests; six Detroit Pizza recipes private pending source URLs
supersedes: none
---

# Source registry, USDA reference tables, and the Pluricook admin

Repo [eikerd/Pluricook](https://github.com/eikerd/Pluricook) (private), branch
`workflow-source-registry`, [PR #1](https://github.com/eikerd/Pluricook/pull/1) — **merged** after three
review rounds. Scorecard: `reports/pr-1.html`. Nothing is deployed; the project has no deploy target yet.

> The repo did not exist at session start. It was created this session from an
> existing local checkout that had one commit (`chore: initialize repository`)
> and no remote. `main` and the feature branch were both pushed.

## What this session did

Designed the acquisition layer by walking one recipe — meatloaf — through the
whole workflow, then built the pieces that the walk proved were needed.

The living design document is a Claude doc, not a file in this repo:
<https://claude.ai/code/artifact/f9d86ce3-4311-4cd8-bef9-a54f5ad3817b>
It holds the full tables (search results, reachability, robots.txt policy,
industry research, USDA coverage, decisions log). This note is the code-side
summary; the doc is the reasoning.

### Built

| Piece | Path | What it is |
|---|---|---|
| Source registry | `src/lib/site-registry.ts`, `src/types/source.ts` | Per-host evidence accumulated across every search |
| Registry tests | `src/lib/site-registry.test.ts` | 16 tests, all passing |
| Observation data | `data/observations/2026-09-20-meatloaf.json` | One file per search; re-import is idempotent |
| Import / report | `scripts/import-observations.ts`, `scripts/site-report.ts` | CLI spreadsheet, sortable, `--csv` |
| USDA download | `scripts/fetch-usda.ts` | Foundation, SR Legacy, FNDDS |
| USDA build | `scripts/build-usda-db.ts` | Into `usda.db`, FTS5 search on descriptions |
| Admin | `src/admin/`, `src/lib/admin-queries.ts`, `src/admin.css` | Read-only browser over both databases |

`sources.db`, `usda.db` and `data/usda/` are gitignored and rebuildable:

```bash
bun scripts/import-observations.ts   # rebuild sources.db from data/observations/
bun scripts/fetch-usda.ts            # download the USDA archives (~13 MB)
bun scripts/build-usda-db.ts         # build usda.db
bun --hot src/index.ts               # admin on :3000
```

### The finding that shaped the design

Of 15 meatloaf recipe pages, 6 answered a plain GET and 9 returned 403. But the
403s are two different problems, and a status code cannot tell them apart:

- **8 were Cloudflare bot challenges.** A managed fetcher cleared both of the two
  retried. Ordinary friction.
- **1 was Allrecipes refusing on stated policy.** Its robots.txt comment prohibits
  scraping except to drive traffic, and names retrieval-augmented generation and
  dataset creation as prohibited uses. It offers a licensing contact instead.

So the registry's `stance` field separates `prohibited` (do not retry, exclude
from the corpus) from `ai-blocked` and `open`. **A written prohibition outranks a
permissive robots.txt** — Allrecipes allows generic crawlers in robots.txt while
prohibiting the exact thing this project does.

A second wrinkle: RecipeTin Eats' own robots rule is `Disallow:` (fully open), but
its ad network (Raptive) injected `anthropic-ai`, `Claude-Web` and `CCbot` bans
above it. The site owner may not know. "Did they say no?" is genuinely ambiguous
for a whole tier of blogs.

### Density is keyed by ingredient *and* condition

The owner's point, confirmed in the data and now reflected in the schema:

| Food record | Measure | Grams |
|---|---|---|
| Spices, oregano, dried | 1 tsp, leaves | 1.0 |
| Spices, oregano, dried | 1 tsp, ground | 1.8 |

80% apart on physical form alone. The density key is `(fdc_id, modifier)`, not
`(ingredient)`. USDA carries condition in both the food description
(`Onions, raw`, `Bread, crumbs, dry, grated`) and the portion modifier.

`src/data/density-conversions.ts` keys by ingredient alone and holds ~25 entries.
Seven of eight spot checks matched USDA exactly, so it was probably transcribed
from USDA originally — but it cannot express the oregano case. **It should be
retired in favour of the USDA portions table**, not extended.

### Bugs fixed in passing

| Bug | Cause |
|---|---|
| `tsc` never type-checked anything | `tsconfig.json` used `baseUrl`, removed in TypeScript 6 |
| No ambient declaration for plain `.css` imports | Scaffold declared only `*.module.css` |
| Sorting USDA portions returned HTTP 500 | `foods` and `portions` both have a `description` column; SQLite resolves a bare name to a table column before a SELECT alias |
| A failed fetch left the previous table's rows on screen | The catch block only cleared the pending flag — wrong data wearing the right label |

## What the next agent should do first

1. **Chunk 4, extraction.** The cascade is settled industry practice: JSON-LD →
   microdata → heuristic HTML → LLM over a *pruned* DOM. About 70% resolves at
   step one, which matches the 5-of-6 measured here. DOM pruning is the cost
   story: ~$0.002/page pruned against ~$0.10 raw.
2. **Write the normalizers before the extractor.** Across five pages, yield came
   back as `8`, `8 serving(s)` and `6 - 8 serving(s)`; time as `PT80M`, `PT85M`,
   `PT1H30M`. Research found seven `recipeYield` shapes, four
   `recipeInstructions` shapes (one nested in `HowToSection`, which makes flat
   parsers silently return section titles only), polymorphic `author`, `@graph`
   wrappers on 4 of 10 pages, and HTML entities leaking into JSON-LD strings.
3. **Mind the `Energy` trap.** USDA emits `Energy` twice per food, in KCAL and
   kJ. A "first Energy row" lookup silently returns kilojoules for some foods.
4. **Decide the Python question.** The mature extractor (`recipe-scrapers`, 740+
   sites) and the best ingredient parser (`ingredient-parser-nlp`, 98.3% word /
   95.6% sentence accuracy) are both Python. This stack is Bun. Either port the
   cascade or run a small Python service. Not decided.

## Later in the same session — extraction through comparison

Everything below landed on the same branch after the first version of this note.

| Piece | Path | What it is |
|---|---|---|
| Starred sources | `data/sources/curated.json`, `src/lib/curated-sources.ts` | Tier + acquisition per site; `mayFetch()` closed by default |
| Provenance | `src/types/provenance.ts` | Required on every recipe; no field exists for headnote, step text or photos |
| Normalizers | `src/lib/normalize.ts` | 7 `recipeYield` shapes, non-ISO durations, `HowToSection` nesting, entities |
| Extraction | `src/lib/recipe-extract.ts`, `scripts/extract-dish.ts` | JSON-LD tier; permission gate runs BEFORE the network call |
| Manual entry | `scripts/add-manual-recipe.ts` | `manual-limited` acquisition with an enforced per-site cap |
| Line repair | `src/lib/ingredient-line.ts` | Fixes the raw parser's unit at the boundary |
| Grams | `src/lib/to-grams.ts` | Mass, volume and COUNT conversion against USDA portions |
| Aliases | `data/ingredients/aliases.json`, `src/lib/ingredient-aliases.ts` | Our mapping, layered on USDA, never amending it |
| Anchor | `src/lib/anchor.ts` | Dish-level reference: meat → grain → legume → dominant → clr |
| Comparison | `src/lib/compare.ts`, `scripts/compare-dish.ts` | Consensus, outliers, salinity with sanity flags |
| Worklist | `scripts/alias-worklist.ts` | What to add to the alias table next, by frequency |
| Regression | `data/ingredients/expectations.json` | Golden matches, counted weights, a coverage floor |

```bash
bun scripts/extract-dish.ts meatloaf          # fetch + extract, permission-gated
bun scripts/compare-dish.ts "lentil soup"     # anchor, consensus, salinity
bun scripts/alias-worklist.ts --top 25        # what to map next
bun test                                      # 184 pass, 3 todo
```

### Three decisions that are easy to get wrong later

**USDA is never edited.** Our knowledge is a superset in `aliases.json`. `usda.db`
is gitignored and rebuilt, so an edit dies at the next rebuild — and an edited
USDA copy stops being citable, which is the whole reason to use it.

**The anchor is chosen per dish, never per recipe.** Otherwise one recipe's
"% of meat" and another's "% of crumbs" are not comparable. A class qualifies at
75% presence and 20% median share of anchorable mass. Water, stock, condiments
and spices are unanchorable, so broth cannot swamp a soup. On lentil soup the
vegetables hold a larger share (48%) than the lentils (43%) and both qualify;
priority picks legume, correctly.

**Ranking heuristics are a dead end; the alias table is not.** A first-segment
rule fixed milk and ground beef and cost 13 points of coverage on bread crumbs.
It was reverted. Heuristics are unbounded — each rule breaks another — while a
mapping table only improves.

### Findings worth keeping

- Nine of thirteen meatloaf recipes land between 1.6% and 1.96% salt-equivalent
  by meat weight, inside the 1.5–2.0% band sausage makers use, and none says so.
  Betty Crocker adds no table salt at all and still reaches 1.9%.
- Meat per serving varies 2.2x across authors. "A serving" is an opinion.
- Every LOW salinity flag pointed at a real gap: unresolved bouillon cubes, a
  brand-named ketchup, and a recipe listing "Kosher salt" with no quantity.
- Coverage: meatloaf 46% → 86%, lentil soup 56% → 72%. The biggest single gain
  was not an alias but learning to COUNT — eggs, cloves, stalks, whole onions —
  which the worklist ranked above every alias miss.

### Owner decisions, continued

- **"the identity of every recipe is based on the source it came from"** —
  attribution is constitutive. No generated recipes; the corpus is observations.
- **"the ratio of spices to a pound of meat is more important to my recipes than
  some concept of an overall amount that a person should eat"** — the basis for
  anchor normalization. It has precedent in baker's percentage, charcuterie
  formulation, and Aitchison's log-ratio analysis of compositional data.
- **"I love the idea of monitoring the salt equivalent in each dish, both for
  health reasons and also for sanity checking"** — salinity is first-class.
- **"We can build test suites from all the edge cases that we're finding"** —
  hence `expectations.json` and its coverage floor.
- Serious Eats is `manual-limited`, capped at 10 hand-entered recipes. People Inc
  licensing was judged out of reach: "they're going to want top institutional
  dollar and we're not going to ever do that."
- America's Test Kitchen stays at `none`: a paid account means clickwrap terms.

### What the next agent should do first

1. **Work the alias worklist.** `bun scripts/alias-worklist.ts`. Every entry lifts
   all future dishes. Verify each `fdcId` — the integrity test enforces it.
2. **Put the comparison in the admin.** It is CLI-only. The owner reads tables;
   `sortable-grid-views` applies, and `render-before-commit` applies to the UI.
3. **Capture a third dish with a different backbone** — a baked good for the
   grain anchor, or pesto, where the true backbone (basil) sits in USDA's
   unanchorable "Spices and Herbs" category and will test the hierarchy hardest.
4. **The three `todo` matcher tests** in `to-grams.test.ts` are real, known gaps.

## Review, and what it found

Three completed rounds, all from **Codex**. Copilot was out of quota. CodeRabbit
never delivered: each push restarted its run, so it was still "processing" at
merge and is NOT counted as a round.

| Round | Commit reviewed | Findings | P1 |
|---|---|---|---|
| 1 | `7225c82` | 6 | 4 |
| 2 | `19282f9` | 5 | 1 |
| 3 | `8fe27cf` | 3 | 2 |

Fourteen findings, all valid, all fixed; thirteen were blind spots I would not
have caught — every one found while the test suite was green. The ones to
remember:

- **The permission gate was open for every unreviewed site** (round 2). An unlisted
  host defaulted to `fetch` while the doc comment, and what the owner had been
  told repeatedly, said the gate was closed by default. Now `pending-review`, with
  clearance on evidence in `src/lib/robots.ts`.
- **`preparation` was never populated** (round 1), so the ground-vs-leaf oregano
  distinction was dead everywhere except the test that fed it by hand.
- **Re-running extract-dish would have deleted the owner's hand-entered recipe.**
- **Round 3's two P1s were regressions from work done earlier the same day** — a
  star click revoking a clearance (caused by round 2's own fix), and a manual cap
  that could be doubled (caused by the personal-collection importer).

**Honest caveat: the round-3 fixes (`514f12c`) merged without a fourth look.**
Findings fell 6 → 5 → 3, but round 3 still held two P1s, so the next PR's first
review should be read as also covering that commit.

## Added after the first handoff: personal collections

| Piece | Path |
|---|---|
| Matrix importer | `src/lib/personal-collection.ts`, `scripts/import-collection.ts` |
| Shared cap counting | `src/lib/hand-entry.ts` |
| robots.txt clearance | `src/lib/robots.ts` |
| The owner's sheet | `data/personal/detroit-pizza.json` |

The owner's Detroit Pizza sheet — six sources, ingredients × sources, mostly grams —
imports as one attributed recipe per column. All six are **private**: the sheet has
names, not links, and no URL was guessed. Adding a `sourceUrl` and re-importing
re-decides visibility against the curated list. `"ownWork": true` marks the owner's
own recipe, publishable with no outbound link because the internal record is its
source. Every recipe has an internal address via `internalRef()`.

The anchor hierarchy chose **grain** unprompted, so the sheet reads in baker's
percentages: hydration 70% of flour (1.2x spread), yeast 1.67% (5.8x spread).
**Salt is misleading as computed**: dough and sauce salt are summed, and only dough
salt is meaningful against flour. Sections are stored but the comparison does not
use them yet — that is the next fix.

## Decided by the owner this session

- **"we can have our own meatloaf query of our own data"** — common recipes are
  served from the corpus; the web tool runs only for uncaptured dishes, and says
  so: *"return the results transparently to them maybe like fresh from the web."*
- **"I would like to make this an app deployed in the cloud… I need to know the
  industry way to handle them"** — obstacles get the industry answer, not a local
  workaround.
- **"I want to see tabular information, like a database spreadsheet… I can
  overlook the data and make sure that we're summing it up right"** — findings
  are presented as tables, not prose.
- **"log individual sites and statistics… so we can learn about their particular
  policies"** — the registry accumulates across searches rather than per run.
- **"download publicly available tables from the USDA… so we don't have to do web
  searches for everything"** — nutrition is local reference data.
- **"all recipes are normalized into mass gram weights"**, and *"densities are a
  combination of ingredients and condition… chopped, cooked, dried, minced,
  powdered"* — grams are the source of truth; imperial is a later display
  conversion.
- **"this is a living concept and we refine it as we go"** — `TODO.md` is a prior
  draft to reconcile, not a spec to follow.
- **"make a cool website with like some restaurant colors… instead of like tech,
  make it a food style website"**, and *"we won't edit it because we'll edit it in
  VS Code if we have to edit raw files"* — the admin is food-styled and read-only.
- **"I want to avoid a million conflicting work trees… just do one feature
  branch"** — one branch, review rounds, then merge.
- **"constantly maintain the server process for me"** — a hot-reloading local
  server, no builds during iteration.
- Repo named **Pluricook**, created private. Favicon is a fork and knife.
- Filter boxes on large tables approved; section blurbs and tile captions declined.

## Loose ends

- **20 pre-existing type errors** surfaced once `tsc` ran, in
  `src/lib/ingredient-parser.ts`, `src/lib/unit-normalizer.ts`, `build.ts` and
  `src/test-parser.ts`. The parser ones are genuine undefined-handling gaps that
  would throw on unusual ingredient strings, and that file is load-bearing for
  comparison. A separate task is queued; not fixed here.
- **`src/App.tsx` and `src/APITester.tsx` are dead code.** `src/frontend.tsx`
  renders `AdminApp` now. `src/logo.svg` and `src/react.svg` are likely dead too.
- **`TODO.md` is stale.** It assumes recipes arrive as pasted text and names
  `general-tso.txt` as test data. Reconciled in the living doc; the file itself
  is unchanged.
- **Serious Eats is almost certainly People Inc** (same 403 signature), but its
  robots.txt was not checked directly, so the registry correctly records
  `unknown` rather than guessing.
- **No trusted-site list yet.** Stance is now measurable, so the list can be
  chosen on evidence. Not chosen.
- **Extraction is not built**; the admin's Recipes tab is deliberately empty.
- **Nothing is deployed anywhere.** Local only.

## Proposed rule changes

- **`money-display.md` has no sibling for scientific units.** This project renders
  masses (grams), volumes, durations and nutrient values, none of which are money,
  and all of which need a single formatter to avoid the six-components-six-
  formatters problem that rule exists to prevent. A `units-display` rule —
  grams whole below 10 g and to one decimal above, durations normalised from
  ISO-8601 before display, a raw-value column kept beside any normalised one —
  would generalise the same lesson. Proposing, not writing.
- **`render-before-commit.md` worked exactly as intended here** and is worth
  keeping as-is: the render surfaced two bugs (the stale-table failure and the
  500 on sort) that a green typecheck would not have caught, before anything was
  committed.
