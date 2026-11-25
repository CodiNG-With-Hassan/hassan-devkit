---
'@coding-with-hassan/devkit': minor
---

`/open-pr` now stops the checkout's Docker stack once the PR is open. Until now a worktree's stack kept running while its PR waited for review, holding Docker memory that every session on the machine shares, until `worktree:prune` removed it after the merge.

- **New command `hassan-devkit worktree:stop`**: stops the stack of the checkout it is run from, across every compose profile. Nothing is removed: the containers, volumes, slot and `.env` stay, and `pnpm docker:dev:up` starts the same stack again with the same data. It stops only a stack the devkit manages for that checkout. In a repo without `docker/docker-compose.dev.yml`, with a `worktree` block that is missing or still the empty skeleton, or in a checkout without a `.env`, it says why, stops nothing and exits 0. A stop that fails exits 1.
- **`open-pr` runs it as its new step 7**, after the tracker transition and before the report, whether the PR was created or updated. It comes last on purpose: when a check or the push fails, the stack is still running for the fix. A failed stop is reported and does not fail the skill, because the PR is already open.
- **Removal is unchanged**: `worktree:prune` (or `worktree:remove`) removes the stack and its data once the PR is merged.
- `standards.md` states the rule in the worktree section: a stack is stopped when its PR opens and removed when it merges.

When review feedback needs the stack again, run `pnpm docker:dev:up` from the worktree root. Typing `/open-pr` afterwards stops it again.
