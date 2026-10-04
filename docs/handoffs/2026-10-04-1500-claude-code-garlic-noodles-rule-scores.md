---
date: 2026-10-04 15:00 America/Chicago
tool: claude-code
model: claude-opus-5-5
repo: eikerd/Pluricook
branch: garlic-noodles, merged to main by PR #4
pr: https://github.com/eikerd/Pluricook/pull/4
state: merged
deployed: no
loose_ends: 5 (listed below)
supersedes: docs/handoffs/2026-09-30-2237-claude-code-raggs.md
---

# Garlic noodles, a table of what USDA lacks, the look-up list, and rule scoring

## What changed, and why

Started 2026-09-30 from the owner's "add another recipe and another workflow
journey… San Francisco style garlic noodles", and grew with each answer:

- **The dish.** Search (20 results) → permission-gated extraction (6 recipes)
  → comparison → admin. Nine plain-food mismatches aliased, each a golden case;
  a `green onion` alias puts scallions in the consensus. Consensus: garlic,
  oyster sauce, fish sauce 6/6; butter, parmesan 5/6; scallions, sugar 4/6.
  Gotchas G19–G23 logged. **G19 fixed** (a raw line break inside JSON-LD).
- **The look-up list** (`data/lookups/<dish>.json`, `docs/manual-lookups.md`).
  *"keep a list of the websites that were denied so we can have someone look
  those up personally"*, and pages that answer with no recipe data *"we'll count
  those as bot-like evasion"*. A person's `handledAt`, `note` and `confirmed`
  survive re-runs (`confirmed` only while the denial kind is unchanged); a page
  that later extracts moves to `resolved`, keeping its gate verdict.
- **Not in USDA** (`data/ingredients/not-in-usda.json`). *"start our own table of
  things that just apparently aren't in USDA"*. Maggi is our spec citing USDA
  **Branded Foods** fdc 2755366 (a dataset we do not load), soy sauce's density
  assumed. Fresh noodles count as dry by dry matter, ×0.77 from USDA's own water
  figures: *"change it to a dry noodle, but make a note that you had to do
  that"*. Reached from `aliases.json` by a negative id.
- **Rule scoring** (`src/lib/rules.ts`, `src/lib/rule-scores.ts`,
  `scripts/rule-scores.ts`, admin **Quality → Rules / Edge cases**). Every
  parser fix, alias, pattern, reject, not-in-USDA entry and extraction repair
  asks `rule(id)` and can be switched off; a rule *caught* a line when the
  outcome changes with it off. Golden cases, `data/rules/verdicts.json` and a
  look-up's `confirmed` say right or wrong; Score = right ÷ (right + wrong).
  Gates are scored by confirmation only — their counterfactual is a forbidden
  fetch. The scorer reads each dish as the comparison does (`ownersView`).
  `data/rules/edge-cases.json` (291 lines) is replayed by a test, keyed by
  occurrence, so any rule change that moves a line fails until reviewed.

## Where it is

- PR #4, merged: the dish and G19, the look-up list, the not-in-USDA table, the
  recipe-page tag, rule scoring, the Quality tabs, a merge of `main` (PR #5,
  RAGGs: five conflicts resolved keeping both sides) and of PR #6 (the owner's
  Detroit pizza clone), review fixes for all three rounds (7 + 1 + 2 findings,
  all fixed), this note, then the scorecard `reports/pr-4.html`.
- Reviewers: Codex three rounds; Copilot once (it cannot be re-requested
  through the API here: 422 "not a collaborator"); CodeRabbit summary only.
- Verified by: `bun test` 525 pass, 0 fail, 3 todo; `tsc --noEmit` at the 15
  pre-existing errors; every other dish's `compare-dish` output byte-identical
  across the alias, not-in-USDA and switchboard changes; each visual change
  rendered from the branch on port 3001.

## What is deployed

Nothing. The project has no deploy target.

## Next agent: start here

1. `bun scripts/rule-scores.ts` — the table. Almost every catch is unverified;
   the Score column fills as golden cases, verdicts and look-up confirmations
   are added.
2. A person works `data/lookups/garlic-noodles.json` (seven pages) by
   `docs/manual-lookups.md`.
3. After any alias or parser change: `bun scripts/rule-scores.ts --write` and
   read the diff of `data/rules/edge-cases.json` before committing it.

## Decided by the owner

- Web recipes only for garlic noodles; Chungus hosting not now.
- Maggi and the like: *"start our own table"*; fresh noodles counted as dry
  with a note; no-data pages counted as suspected bot evasion.
- Rule scoring: *"caught" = changed + verified*; all rule kinds; an admin tab.
- The recipe-page tag approved; the Quality tabs committed at the owner's
  request to open the PR.
- 2026-10-04: *"clean this up. I don't want any stray directories, babysit these
  PRs and get these merged"*; the stray untracked `AGENTS.md` (a copy of the
  Cursor Bun rule) moved to the Trash at the owner's word.

## Loose ends

1. **Figma**: the project has no Figma file key, so the Quality tabs, the
   recipe-page tag and the RAGG screens are not in Figma.
2. **Wrong matches still open** from PR #5's note: ketchup → pomegranate juice,
   "whole or 2% milk" → frozen dessert, mustard → mustard greens, "cumin and
   coriander powder" → powdered sugar.
3. **Unused search terms**: `data/search-terms.json`, `src/lib/search-terms.ts`
   and `scripts/seed-search-terms.ts` are no longer used by the app (PR #5); the
   one guard test that still reads them is why garlic noodles got a term.
4. **Branded Foods** is not loaded. Maggi's figures come from one record by
   hand; loading the dataset would be the general answer.
5. **G20, G21** (one recipe on several sites; alternatives in one line) are
   logged, not fixed.

## Proposed rule changes

None.
