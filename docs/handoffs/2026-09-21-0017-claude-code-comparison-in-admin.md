---
date: 2026-09-21 00:17 America/Chicago
tool: claude-code
model: claude-fable-5-1
repo: eikerd/Pluricook
branch: comparison-in-admin
pr: https://github.com/eikerd/Pluricook/pull/2
state: pr-open
deployed: no
loose-ends: PR #2 open, external review rounds not yet complete; no ESLint or react-hooks lint in the repo (task chip raised); no Figma file exists for this project, so the new Comparison page is not in Figma; six Detroit pizza recipes still private pending source URLs; "Charlie A" read as Charlie Anderson, unconfirmed; RecipeTin Eats broth and bouillon lines do not parse (reads "low" salinity in two dishes); 16 pre-existing type errors in ingredient-parser/unit-normalizer/build.ts; dead scaffold files App.tsx and APITester.tsx; TODO.md stale; 3 todo matcher tests; extraction is JSON-LD only
supersedes: docs/handoffs/2026-09-20-1930-claude-code-source-registry-usda-admin.md
---

# The comparison, in the admin, by section

Repo [eikerd/Pluricook](https://github.com/eikerd/Pluricook) (private), branch
`comparison-in-admin`, [PR #2](https://github.com/eikerd/Pluricook/pull/2) — **open**.
Nothing is deployed; the project has no deploy target yet.

The reasoning and the full tables live in the Claude doc, which this session
brought up to date (six new sections, rev 29):
<https://claude.ai/code/artifact/f9d86ce3-4311-4cd8-bef9-a54f5ad3817b>

## What changed, and why

The comparison — consensus amounts, outliers, salt-equivalent — existed only as
`bun scripts/compare-dish.ts`. The owner asked to keep building the app, and the
previous note listed "comparison not in the admin UI and not section-aware" first
among its loose ends.

| Piece | Path | What it is |
|---|---|---|
| Section-aware comparison | `src/lib/compare.ts` | `compareRecipes({ section })`. A named section compares only that section's lines, and chooses its own anchor from them. Recipes without the section take no part. |
| Service + API | `src/lib/compare-service.ts`, `src/index.ts` | `GET /api/admin/dishes`, `GET /api/admin/compare/:dish?section=`. No comparison logic here, so CLI and admin cannot disagree. The dish becomes a file path, so it is held to `^[a-z0-9][a-z0-9-]*$`. |
| First tests for compare.ts | `src/lib/compare.test.ts` | Ten tests on synthetic gram-stated recipes whose expected figures can be worked out by hand. `compare.ts` merged in #1 with none. |
| Comparison page | `src/admin/ComparisonView.tsx` | Dish and section pickers; Consensus, Salinity, Outliers and Unmatched lines grids; the anchor's reason under the title; ingredient rows open to each site's line as published. |
| Client-side grid | `src/admin/SortableGrid.tsx` | Same markup and classes as `DataTable`, which keeps sorting on the server for the 13,694-row USDA tables. Open rows are remembered by key, so they survive a re-sort. |
| Sodium aliases | `data/ingredients/aliases.json`, `expectations.json` | soy sauce, bacon, chicken/beef/vegetable broth and stock, grated parmesan; eight regression fixtures. |
| Parser repair | `src/lib/ingredient-line.ts` | Strips the abbreviation dot that `1 tbsp. soy sauce` left on the name. |
| usda.db journal mode | `scripts/build-usda-db.ts` | Ends the build with `journal_mode = DELETE`. |
| Pizza sections | `data/personal/detroit-pizza.json` | `dough and toppings` split into `dough` and `toppings`. |

### Three findings worth knowing

**Salinity was reading about four times low.** The first salinity test written
failed: 60 g of soy sauce added 2.1 g of salt-equivalent where 8.4 g was due.
`soy sauce` matched *Sauce, peanut, made from peanut butter, water, soy sauce*;
`chicken broth` matched *Chicken, canned, no broth* — on the word it negates;
`bacon` matched *Bacon, meatless*. These are the lines a salinity figure is
mostly made of. Bacon is aliased to the **raw** record on purpose: a recipe's
bacon goes in raw, and the cooked record reads three times saltier once the
water has left.

**An exact alias silently did nothing for abbreviated units.** `1 tbsp. soy sauce`
parsed to the name `. soy sauce`. USDA's full-text search ignores punctuation,
which is how it hid; an exact alias lookup does not.

**usda.db in WAL mode is a trap.** A WAL database cannot be opened read-only
once its `-shm`/`-wal` sidecars are gone, and any tool that opens it read-write
and exits cleanly deletes them. One `sqlite3 usda.db .schema` took down every
reader with `SQLITE_CANTOPEN`. The existing file was converted in place
(`PRAGMA journal_mode = DELETE`); a rebuild now produces the same. A read-only
cloud filesystem would have required this anyway.

### Local review, before the external rounds

Two review agents ran on the branch. Neither found a critical issue; the React
reviewer confirmed the URL allowlist and the fetch-race guard. Everything valid
was fixed on the branch:

| Finding | Fix |
|---|---|
| A dish had two identifiers — the `dish` field inside the JSON, and the filename the route opens | A dish is its filename, the only identifier the route ever used |
| One malformed recipe file 500'd the picker for every dish | It costs one dish; the server log names the file. Failures answer as `{error}` |
| Row keys could collide — two URL-less recipes from one site, or one recipe listing "salt, to taste" twice | Every row carries `recipeId`; unmatched lines add their place in the list |
| Changing section left the old numbers under the new section name until the fetch landed | The answer is stored with its question; anything stale is dimmed, as `DataTable` does. The anchor line sat outside the dimmed region — found by slowing `fetch` in the browser |
| Sortable headers had no interactive role | A real `<button>` inside each `th`; tables are named; buttons state `type="button"` |
| `.find(...)!` in tests would crash on undefined rather than fail | `saltOf()` asserts presence first |

Not fixed, deliberately: section names match case-sensitively (the UI only ever
sends names from `sectionsAvailable`); no `AbortController` on the fetch (matches
`DataTable`, and the `stale` flag already guards the race).

### What the numbers say now

| Dish or section | Anchor | Median salt-equivalent | Note |
|---|---|---|---|
| Meatloaf | meat | 1.87% | Table salt alone is a median 0.66%: two-thirds of the sodium is ketchup, breadcrumbs, Worcestershire |
| Lentil soup | legume | 4.03% | |
| Detroit pizza, whole | grain | 3.66% | Serious Eats flags high at 11.7% — 340 g of pepperoni |
| Detroit pizza, dough | grain | 1.88% | All six ok. Water 70.02%, salt 1.89%, yeast 1.67% of flour |
| Detroit pizza, toppings | dairy | 1.42% | 3 recipes |
| Detroit pizza, sauce | vegetable | 1.09% | 4 recipes |

## Where it is

- Branch `comparison-in-admin`, pushed; PR #2 marked ready for review once this note landed.
- Working directly in the main checkout (`/Users/ernestoikerd/repos/food/compare-recipe`); no worktree was created.
- Dev server: `bun --hot src/index.ts` on port 3000, via `.claude/launch.json` (`pluricook-admin`).
- `bun test`: 297 pass, 3 todo, 0 fail. `tsc --noEmit`: no new errors.

## What is deployed

Nothing. There is no deploy target yet.

## Loose ends

- **PR #2 is open.** Three review rounds, the scorecard and the merge are still to do.
- **No linter.** The repo has no ESLint at all, so `react-hooks/exhaustive-deps` has never run on the admin. Out of scope here; raised as a task chip ("Add ESLint with react-hooks rules to Pluricook").
- **CodeRabbit's green check on a draft is a skip, not a review.** It declines draft PRs and still reports SUCCESS. Do not count it as a round.
- **Figma:** the project has no Figma file, so the new Comparison page is recorded nowhere but the code. Not skipped silently — there is nothing to update yet.
- **A dev-server gotcha, not a bug:** `git checkout main` while local `main` still pointed at the scaffold commit left Bun's bundler serving `src/App.tsx` (the stock "Bun + React" page) under the admin's title. Restarting the preview server fixed it. If the admin ever shows the Bun logo, restart before debugging.
- RecipeTin Eats reads "low" salinity in both meatloaf and lentil soup because `2 beef bouillon cubes (, crumbled or 2 tsp beef powder (Note 2))` and `1.5 litres / 1.5 quarts (6 cups) vegetable or chicken (stock / broth, low sodium)` do not resolve. The Unmatched lines grid shows them. It is a parser miss, not a salt-shy cook.
- Six Detroit pizza recipes are private pending source URLs; "Charlie A" was read as Charlie Anderson and is unconfirmed; the owner has not yet checked the transcription of the sheet.
- Carried from the previous note: 16 pre-existing type errors (`ingredient-parser.ts`, `unit-normalizer.ts`, `build.ts`); dead `src/App.tsx` and `src/APITester.tsx`; stale `TODO.md`; 3 `todo` matcher tests; extraction is JSON-LD only.
- ECC Tools audits this private repo per commit; whether to grant it "Checks: read and write", and on which plan, is the owner's decision and is still open.

## Next agent: start here

1. `gh pr view 2` — see where the review rounds stand; address findings on this branch, not a new one.
2. Open the admin (`preview_start pluricook-admin`), go to Comparison → Meatloaf, and open the "Salt, table" row: that drill-down is the fastest way to see what the comparison is doing.
3. Next dish to test the anchor logic: **pesto**. Basil is in USDA's unanchorable "Spices and Herbs" class, so the dish should fall through to nut, dairy or fat. If it anchors on something silly, that is the finding.
4. `bun scripts/alias-worklist.ts` lists unmatched lines by frequency; the broth and bouillon lines above are the most valuable.

## Decided by the owner

- On the first render of the Comparison page: "Approve, commit it".
- Asked which optional additions to include, chose all three: "Per-source drill-down, Unmatched lines grid, Anchor reasoning line".
- On the pizza's combined section: "Split into dough / toppings (Recommended)".
- On the second render: "Approve, commit it".

## Proposed rule changes

- **`render-before-commit`**: worth one line saying an owner-chosen addition still needs its own render before commit. This session asked twice (the page, then the three additions); that felt right, but the rule does not say whether approving an addition in words covers its pixels.
- **Project `CLAUDE.md`** (a fact that is true whenever it is read): "`usda.db` must not be left in WAL mode — a read-only open fails once the sidecar files are gone. `build-usda-db.ts` ends with `journal_mode = DELETE`; do not remove it."
- **Project `CLAUDE.md`**: "If the admin shows the stock Bun + React page, the dev bundler is holding a stale module graph — restart the preview server."
