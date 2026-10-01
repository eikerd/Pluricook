# Manual lookups: pages automation could not take

Every dish run (`bun scripts/extract-dish.ts <dish>`) leaves a list of the
recipe pages it could not take, at `data/lookups/<dish>.json`, for a person to
check in an ordinary browser.

The owner, 2026-09-30: "keep a list of the websites that were denied so we can
have someone look those up personally", and pages that answer with no recipe
data "we'll count those as bot-like evasion… have a person go and double check
any sites that we can't reach by automation."

## What each kind means, and what to check

| `denial` | What happened | What the person checks |
|---|---|---|
| `evasion-suspected` | The page answered but gave automation no recipe: no structured data, no Recipe in it, or a Recipe with no ingredients. | Open it. Is there a recipe a reader can see? If yes, note where the ingredients are (a plugin, an image, behind a click). If no, it is not a recipe page; say so. |
| `refused` | The site answered 401, 403 or 429: a bot challenge or a block. | Does it open for a person? Note whether a challenge appeared. |
| `unreachable` | Any other error, a timeout, a dead link. | Does the page exist? Has it moved? |
| `policy` | Our own rule in `data/sources/curated.json` says take nothing (`none`, `pending-review`). | Nothing is taken. Note anything that would help the owner decide the site's rule: a paywall, a licence offer. |
| `not-cleared` | The site is not in `curated.json`, and its robots.txt did not clear it. | Note what the site says about reuse, for the owner to curate it. |
| `blocked` | A written prohibition; the site is excluded from the corpus. | Nothing. Listed so the gap is visible. |

`acquisition` on each entry is the site's rule at the time of the run.

## Recording what you found

Edit the entry in `data/lookups/<dish>.json`:

- `handledAt`: the date you checked, `YYYY-MM-DD`.
- `note`: what you found, in a sentence.
- `confirmed`: `true` when the page really was what its kind says (a recipe a
  person can see but automation could not, a real block), `false` when it was
  not (no recipe on the page at all, or it opened fine). This scores the gate
  in the admin's **Rules** tab (`gate:evasion-suspected` and the rest): how
  often each kind sent a person somewhere worth going.

Re-runs keep both. An entry drops off by itself once a later run extracts the
page.

## Entering a recipe by hand

A person reading a page is still bound by the site's rule. A recipe is entered
by hand only from a site curated as `manual-limited`, within its cap, through
`bun scripts/add-manual-recipe.ts <file>`; the script refuses anything else. If
a page on the list should be entered and its site is not `manual-limited`,
that is the owner's decision in `curated.json`, not the person's.

Type in the facts only: ingredient lines, servings, times and a step count.
Never the headnote, the method's wording or the photos. See the comment at the
top of `scripts/add-manual-recipe.ts`.
