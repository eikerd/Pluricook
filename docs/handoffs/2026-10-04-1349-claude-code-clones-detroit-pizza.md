---
date: 2026-10-04 13:49 America/Chicago
tool: claude-code
model: claude-fable-5-1
repo: eikerd/Pluricook
branch: clones-detroit-pizza
pr: https://github.com/eikerd/Pluricook/pull/6
state: pr-open
deployed: no
loose-ends: untracked AGENTS.md in the main checkout (verbatim copy of CLAUDE.md, another tool, 2026-09-21 — an instruction file, left for the owner); worktree compare-recipe-wt-raggs still registered on a merged branch (another session's); local main in the main checkout is 12 commits behind origin/main — pull before branching there
supersedes: none
---

# The owner's Detroit pizza clone, committed

One data file. `data/clones/detroit-pizza.json` is the owner's working copy of
Ethan Chlebowski's Detroit pizza, made through the admin's recipe page on
2026-10-01 and written by `src/lib/clones.ts`. The directory had never been
committed, so the clone existed in one checkout only. It is the same class of
data as `data/recipes/` and `data/personal/`, which are tracked.

## Where it is

- Branch `clones-detroit-pizza` from `origin/main`, [PR #6](https://github.com/eikerd/Pluricook/pull/6), ready for review.
- Built in a worktree and the worktree removed; the branch is pushed with nothing uncommitted.
- The same file still sits untracked in the main checkout. It is byte-identical, so a `git pull` there after merge is a no-op for it.

## Next agent: start here

1. Let the review bots run; this is data only, so expect no findings.
2. Merge, then `git pull` in the main checkout.
3. The loose ends above are the owner's calls, not yours.

## Decided by the owner

- "Create PR" chosen three times for this checkout's uncommitted changes; the clone data is what that can mean without touching an instruction file.

## Proposed rule changes

- None.
