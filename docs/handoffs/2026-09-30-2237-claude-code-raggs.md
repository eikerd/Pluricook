---
date: 2026-09-30 22:37 America/Chicago
tool: claude-code
model: claude-opus-5-5
repo: eikerd/Pluricook
branch: raggs (worktree ../compare-recipe-wt-raggs)
pr: https://github.com/eikerd/Pluricook/pull/5
state: pr-open
deployed: no
loose_ends: 7 (listed below)
supersedes: docs/handoffs/2026-09-29-2310-claude-code-search-terms-usda-viewer.md
---

# RAGGs at the top, recipes as spreadsheets, one weight of the primary ingredient

## What changed, and why

The owner, 2026-09-30, on the admin as it stood: the dishes were buried under
a 100-row search-terms list and an Overview of pipeline counts. The concept is
the **RAGG — recipe aggregate**: what someone searched for, and the sourced
recipes gathered for it. *"That needs to be the top of our application."*

- **RAGGs are the home page** (`src/lib/raggs.ts`, `src/admin/Raggs.tsx`):
  newest first, with Created, Recipes, Sites, and the three ingredients the
  most recipes share (from the comparison, so list and page agree). Each RAGG
  is also in the rail. `/ragg/<slug>` opens its recipes (site, location,
  title…) with Comparison and Visualize pinned to it, and **lands on the
  stacked chart**: *"this screen right here is the default landing page."*
- **Gone from the app**: the search terms (`/terms/`, its table and API), the
  Searches table, the Overview counts. Sources, Fetch log, USDA foods and
  portions, and all Recipes sit under "Data" at the bottom.
- **A recipe is a spreadsheet** (`CellInput.tsx`, `RecipeLines.tsx`,
  `RecipePage.tsx`): details as one row, lines one row each, edited in place.
  A cell saves when left (Enter moves down, Escape undoes, × deletes, a blank
  last row adds; retyping a Section moves the line). Saves are queued in order
  and only the latest answer is applied. Edits are still corrections beside
  the published recipe. The Edit form is gone.
- **Every grid on one line**: no wrapping, no ellipsis; grids scroll sideways.
  *"Make everything fit on one line like a spreadsheet until I tell you to do
  it differently for all line items and list terms."*
- **Stacked chart, normalized** (`charts/stack.ts`, `charts/Stacked.tsx`):
  every recipe scaled to **450 g of its anchor class** (meat, legume, grain);
  that class leaves the bars, *"because it's the same for each one."*
  Ingredients run heaviest first (*"by mass from left to right"*); the legend
  is names only (*"we don't need the numbers"*); clicking a legend name sorts
  the bars by it, again reverses it (*"make those labels trigger a sort"*).
- **Equivalent USDA foods** (`src/lib/equivalents.ts`,
  `data/ingredients/equivalents.json`): foods a cook would swap fold into one
  before the comparison clusters — four broths, three lentils were four and
  three bands. Broth's default is chicken broth: *"with the default being like
  any non-veg."* A line keeps its own match for grams and sodium.

## Where it is

- Branch `raggs`, four commits on `origin/main` (12142d7): equivalents, RAGGs,
  spreadsheet editing, the stacked chart — then this note.
- Verified by: `bun test` 471 pass, 0 fail; `tsc --noEmit` at the 15
  pre-existing errors; every visual change rendered from this branch on port
  3002 and approved by the owner before commit. Editing was exercised in the
  browser (edit, add, delete a line) and the test correction removed.

## What is deployed

Nothing. The project has no deploy target.

## What the next agent should do first

1. Mark the PR ready, request Copilot, run the three review rounds, scorecard,
   merge (docs/pr-workflow.md).
2. PR #4 (garlic noodles) touches `data/search-terms.json` and
   `data/ingredients/aliases.json`. After both merge, garlic noodles appears as
   a RAGG on its own (the list is the files in `data/recipes/`).

## Decided by the owner

- Name: **RAGG** ("Aggregate (RAGG)"); meatloaf stays listed; Sites is the one
  extra list column; side tables demoted, not removed.
- *"The Overview page is worthless unless it just lists our RAGGs from newest
  to oldest."*
- Pantry ("what's in my fridge" substitution, diet tags): *"a low priority"* —
  not started.

## Loose ends

1. **Wrong USDA matches** for alias fixes in `aliases.json` (left out to avoid
   colliding with PR #4): McCormick "French's Tomato Ketchup" → pomegranate
   juice; The Kitchn "whole or 2% milk" → frozen chocolate milk dessert; Dijon /
   dry mustard → mustard greens; "cumin and coriander powder" → powdered sugar;
   RecipeTin's "1.5 litres … stock / broth" matches nothing.
2. **Open questions to the owner**: 450 g for every RAGG, or per RAGG? Axis by
   class ("of legume") or by food ("of lentils")?
3. `data/search-terms.json`, `src/lib/search-terms.ts` and
   `scripts/seed-search-terms.ts` are no longer used by the app; delete after
   PR #4 merges (it edits the JSON).
4. **Figma**: the project has no Figma file key in `CLAUDE.md`, so the new
   RAGG list, RAGG page, sheet editor and chart are not in Figma.
5. PR #4 (`garlic-noodles`, draft) is another session's; untouched.
6. The main checkout holds another session's untracked `AGENTS.md` and
   `data/clones/`; untouched.
7. Dev server for this branch was left running on port 3002 for the owner;
   another session's server holds 3001.

## Proposed rule changes

None.
