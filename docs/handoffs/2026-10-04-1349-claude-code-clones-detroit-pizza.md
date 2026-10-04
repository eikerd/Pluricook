---
date: 2026-10-04 13:49 America/Chicago
tool: claude-code
model: claude-fable-5-1
repo: eikerd/Pluricook
branch: main (clones-detroit-pizza merged and deleted)
pr: https://github.com/eikerd/Pluricook/pull/6
state: merged
deployed: no
loose-ends: untracked AGENTS.md in the main checkout (verbatim copy of CLAUDE.md, another tool, 2026-09-21 — an instruction file, left for the owner); PR #4 garlic-noodles is another session's, open and ready, with its own worktree — not touched
supersedes: none
---

# The owner's Detroit pizza clone, committed

One data file. `data/clones/detroit-pizza.json` is the owner's working copy of
Ethan Chlebowski's Detroit pizza, made through the admin's recipe page on
2026-10-01 and written by `src/lib/clones.ts`. The directory had never been
committed, so the clone existed in one checkout only. It is the same class of
data as `data/recipes/` and `data/personal/`, which are tracked.

## Where it is

- Branch `clones-detroit-pizza` from `origin/main`, [PR #6](https://github.com/eikerd/Pluricook/pull/6) — **merged** after three Codex rounds (one finding, fixed). Scorecard: `reports/pr-6.html`.
- Built in a worktree and the worktree removed; the branch is pushed with nothing uncommitted.
- The same file still sits untracked in the main checkout. It is byte-identical, so a `git pull` there after merge is a no-op for it.

## Next agent: start here

1. Nothing is owed on this PR. The main checkout was pulled and the stale `raggs` worktree and branch removed in the same session.
2. The loose ends above are the owner's calls, not yours.

## Decided by the owner

- "Three rounds, get it merged." · "I don't want any leftover work trees or fucking PRs." — hence the `raggs` cleanup, done with the owner's word.

- "Create PR" chosen three times for this checkout's uncommitted changes; the clone data is what that can mean without touching an instruction file.

## Proposed rule changes

- None.
