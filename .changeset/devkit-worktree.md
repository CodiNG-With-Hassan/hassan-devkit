---
'@coding-with-hassan/devkit': minor
---

`worktree:*` — parallel-development worktrees with isolated Docker stacks, ported from car-rental's `scripts/worktree.sh` to Node:

- `worktree:create <branch> [--profiles a,b] [--no-up]`: prunes merged worktrees, fetches the canonical remote (`upstream`, else `origin`), adds the worktree off its `main`, allocates the lowest free slot under a cross-checkout lock, writes the managed `.env` block (`DEVKIT_*` keys, ports = base + slot×10), runs the tracker hook, `pnpm install`, bootstraps husky (hard failure when `.husky/_/pre-commit` is missing — git silently skips hooks otherwise), builds only the images the tag lacks, starts the stack, waits for `worktree.ready.url`, runs `worktree.seeds`.
- `worktree:env [--slot N]`: refresh the current checkout's block keeping slot + profiles; refuses a slot another checkout holds; drops `node_modules` volumes of stale tags. `docker:up` runs it implicitly when `worktree` is configured.
- `worktree:profiles list|add|remove`: profiles come from the compose file; `worktree.profiles.required` cannot be removed.
- `worktree:remove [--keep-data] [--force]`, `worktree:prune [--dry-run]` (PR state via `gh pr list --head`, only MERGED removes; dirty trees are never force-removed), `worktree:list` (duplicate-slot warning).
- A repo without `docker/docker-compose.dev.yml` gets worktrees without a stack (no `.env`, no slot).
- Image tag inputs now include the Dockerfiles of the compose file's buildable services.
