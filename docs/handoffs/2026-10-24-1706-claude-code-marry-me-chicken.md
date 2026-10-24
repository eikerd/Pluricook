---
date: 2026-10-24 17:06 America/Chicago
tool: claude-code
model: claude-opus-5-5
repo: eikerd/Pluricook
branch: marry-me-chicken, merged to main by PR #10
pr: https://github.com/eikerd/Pluricook/pull/10
state: merged
deployed: no
loose_ends: 5 (listed below)
supersedes: docs/handoffs/2026-10-04-1500-claude-code-garlic-noodles-rule-scores.md
---

# Marry Me Chicken, and That Dude Can Cook's version from the owner's paste

## What changed, and why

The owner: *"Now lets try Marry Me Chicken"*, then mid-run a pasted ingredient
list *"for That Dude Can Cook"*. Search (20 results) → permission-gated
extraction (7 recipes) → comparison, plus the paste as a private personal
collection and a verbatim fixture. Before the fixes, chicken breast converted in
none of eight recipes and the comparison anchored on dairy. It now anchors on
meat: broth and garlic 8/8; chicken breast, heavy cream, Parmesan, sun-dried
tomatoes, olive oil, red pepper flakes 7/8.

Gotchas G29–G36 logged in `docs/recipe-gotchas.md`, each fixed but G33 (partly)
and G34. New rules, each with an off switch: `line:piece-is-whole` (G29),
`line:poured-not-whipped` (G30), `line:container-net-weight` (G31),
`parse:bare-alternate` (G32), `extract:one-line-is-no-recipe` (G33),
`line:trailing-preparation` and `line:alias-before-comma` (G35),
`line:plural-portion` (G36). G35 also fixed eleven lines in older dishes: eggs
now 50 g each, a yellow onion 110 g, meatloaf's ketchup and Dijon.

## Where it is

- Commits: f94d591 the dish · b222f48 the paste (G35, G36) · dff7af8, 45d6f71,
  bed0f27 review rounds 1–3 · this note · the scorecard `reports/pr-10.html`.
- Files that matter: `data/recipes/marry-me-chicken.json`,
  `data/lookups/marry-me-chicken.json`, `data/personal/marry-me-chicken.json`,
  `data/fixtures/marry-me-chicken-thatdudecancook.txt`,
  `data/ingredients/aliases.json`, `src/lib/to-grams.ts`,
  `src/lib/ingredient-line.ts`, `src/lib/ingredient-parser.ts`,
  `src/lib/recipe-extract.ts`, `src/lib/rule-scores.ts`.
- Reviews: Codex three rounds (1, 1, 0 findings); Greptile once in round 3
  (3 findings, one a duplicate of Codex's round 2); Copilot out of quota;
  CodeRabbit summary only. All fixed.
- Verified by: `bun test` 583 pass, 0 fail, 3 todo; `tsc --noEmit` at 14
  errors, all on main already; `edge-cases.json` diff read after every rule
  change (only improvements in other dishes); the dish rendered from the branch
  on port 3001 (RAGG → Marry me chicken → Comparison).

## What is deployed

Nothing. The project has no deploy target.

## Loose ends

1. **G34**: Italian seasoning reaches *Seasoning mix, dry, taco* in two
   recipes. Needs a not-in-USDA entry citing Branded Foods, as Maggi has.
2. **G33, partly**: Sweet y Salado's own JSON-LD says `4 boneless`; the line
   stays in the corpus with no grams.
3. **Nine pages** for a person in `data/lookups/marry-me-chicken.json` (five
   HTTP 403, four with no usable recipe). Kikkoman's page lists fourteen lines
   in its HTML.
4. **That Dude Can Cook** is private: no video URL is on file.
5. **Sweep**: PR #9 (draft, `chore/rename-pluricook`) is someone else's and
   untouched; the main checkout's untracked `AGENTS.md` is not this session's.
   Figma: the project has no Figma file key, and this PR changed no UI.

## Next agent: start here

1. G34: find Italian seasoning in USDA Branded Foods and add a
   `not-in-usda.json` food entry, then a `pattern` alias.
2. After any alias or parser change: `bun scripts/rule-scores.ts --write` and
   read the `data/rules/edge-cases.json` diff before committing it.

## Decided by the owner

- "Now lets try Marry Me Chicken" — the dish, by the garlic noodles route.
- "for That Dude Can Cook" with the pasted list — added as that creator's
  version, private, the paste kept verbatim as an intake test.
- "Yes, mark PR #10 ready and run the three review rounds."

## Proposed rule changes

None.
