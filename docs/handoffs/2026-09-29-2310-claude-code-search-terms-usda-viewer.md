---
date: 2026-09-29 23:10 America/Chicago
tool: claude-code
model: claude-opus-5-5
repo: eikerd/Pluricook
branch: main (recipe-gotchas merged and deleted)
pr: https://github.com/eikerd/Pluricook/pull/3
state: merged
deployed: no
loose_ends: 6 (listed below)
supersedes: docs/handoffs/2026-09-21-0017-claude-code-comparison-in-admin.md
---

# Recipe pages, the USDA viewer, search terms, and the gotchas log

## What changed, and why

One session, started from the owner's apple fritter recipe, landed as
[PR #3](https://github.com/eikerd/Pluricook/pull/3) after three review rounds
(scorecard: `reports/pr-3.html`). In order:

- **Gotchas log** (`docs/recipe-gotchas.md`, G1–G18) and **format notes**
  (`docs/recipe-format.md`, Cooklang considered and not adopted). Parser fixes
  G6, G7, G11, G12, and G18 (a measure after a slash), each test-first.
- **Stacked**, the eighth Visualize view: one horizontal bar per recipe, split
  by ingredient.
- **A page for every recipe** at `/recipes/<id>`: its lines as a sortable
  sheet, corrections saved beside the published recipe
  (`data/corrections/`), and the owner's own copies (`data/clones/`).
- **USDA viewer**: Category and Class columns on USDA foods, and a page per
  food at `/usda/<fdc id>`.
- **Survey nutrients fixed**: the FNDDS download stores old nutrient numbers
  where the others store ids, so none of 353,015 survey values joined. The
  build now translates them; a `ground meat` alias keeps The Kitchn's meatloaf
  honest once survey sodium counts.
- **Search terms**: 102 terms seeded into `data/search-terms.json` from the
  owner's top-100 list, a Search terms tab, and a landing page per term at
  `/terms/<slug>` listing the recipes attached to it.

## Where it is

- Merged to `main` as PR #3: 19 commits, from `f28429e` (the gotchas log) to
  the scorecard. The last five before the note are review fixes: `85cd703`,
  `6b2fe5c` (round 1), `65a24be` (round 2), `5f80105`, `0ec423f` (round 3).
- Files that matter: `src/lib/search-terms.ts`, `scripts/seed-search-terms.ts`,
  `src/lib/usda-food.ts`, `src/lib/usda-categories.ts`, `src/lib/usda-csv.ts`
  (`nutrientIdResolver`), `scripts/build-usda-db.ts`, `src/lib/admin-queries.ts`,
  `src/admin/{AdminApp,TermPage,UsdaFoodPage,RecipePage,DataTable,SortableGrid}.tsx`,
  `src/admin/row-link.ts`.
- Verified by: `bun test` 452 pass (358 pass and 97 skip with usda.db moved
  aside); `tsc --noEmit` at the 15 pre-existing errors; every UI change
  rendered in the running app and approved by the owner before commit; every
  dish's comparison diffed before and after the usda.db rebuild.

## What is deployed

Nothing. The project has no deploy target yet. The owner asked whether chungus
has room: it does — 7.8 GiB RAM with 5.2 free, 4 idle cores, 18 GB of disk
free at 85% used, and Docker reports ~67 GB of reclaimable build cache (not
pruned; ask first). Pluricook needs roughly 0.3 GB and 100 MB of RAM.

## Loose ends

1. **usda.db on main is the old build.** Survey foods show no nutrients there
   until it is rebuilt: `bun scripts/build-usda-db.ts` in the main checkout
   (the downloads are in its `data/usda/`).
2. **No Figma file** exists for this project, so none of these screens are in
   Figma.
3. **Untracked `AGENTS.md`** in the main checkout, written by another tool
   before this session; left untouched.
4. **Reviewers:** Copilot's daily quota was spent, and CodeRabbit is on the
   Free plan (summary only), so Codex did all the line review.
5. **Gotchas still open:** G1–G5 (sub-recipes), G8, G9, G10, G13, G14, G15,
   G17. The flour split was a candidate G18 and not logged, per the owner.
6. **Deleting a recipe's last copy** leaves `data/clones/<dish>.json` holding an
   empty list; harmless, but it shows as untracked.

## Next agent: start here

1. Rebuild usda.db on main (`bun scripts/build-usda-db.ts`), then open
   `/usda/2706337` (Abalone): it should read 177 kcal with every nutrient named.
2. Colour-coding foods by class is the step the owner named next: "food should
   be in categories that we can color code". 44% of foods class as
   *unanchorable*, so class alone would paint nearly half one colour; choose
   the colours with the owner.
3. Hosting on chungus, if the owner wants it: a Dockerfile, a compose service
   and an nginx route, shipped from `origin/main` only.

## Decided by the owner

- "Split dishes, merge variants" — the four list lines naming two things: #28
  split into Guinness Stew and Beef Stroganoff; Quiche, Ribs and Beef
  Tenderloin keep their other names as aliases.
- Search terms tab columns: Rank, Term, Group, plus "Recipes attached" and
  "Slug" (not "Last searched").
- "Yes, a page per term" — `/terms/<slug>`.
- "Commit, then fix nutrients" — the USDA viewer committed, then the survey
  nutrient numbering repaired.
- "Use the IP" — every render comes with a link on the Tailscale address,
  `http://100.88.181.53:3000`.

## Proposed rule changes

None.
