---
tool: claude-code
model: Fable 5.1, then Opus 5
repo: eikerd/Pluricook
branch: workflow-source-registry
pr: https://github.com/eikerd/Pluricook/pull/1
state: pr-open
deployed: no
loose-ends: 20 pre-existing type errors in ingredient-parser and unit-normalizer; dead scaffold files (App.tsx, APITester.tsx); TODO.md stale; no trusted-site list; extraction not built
supersedes: none
---

# Source registry, USDA reference tables, and the Pluricook admin

Repo [eikerd/Pluricook](https://github.com/eikerd/Pluricook) (private), branch
`workflow-source-registry`, draft [PR #1](https://github.com/eikerd/Pluricook/pull/1).
Nothing is deployed. `agent-sweep.sh` reports only this PR.

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
