---
name: merge-upstream
description: "Bring the canonical remote's main into the current checkout the house way: fetch, stop when up to date, merge (fast-forward only on the base branch), install the merged toolchain BEFORE completing a conflicted merge so the pre-commit fixers run with the presets upstream was formatted with, restore hook-rewritten files, then refresh what the merged files need. User-invocable only: it creates the merge commit."
disable-model-invocation: true
---

# merge-upstream (body shipped by @coding-with-hassan/devkit)

Bring the canonical `main` into the checkout you are in. The user invoking this skill is the
consent for exactly one commit: the merge commit. Never push; never rebase (branches are shared
through their PRs and the house merges).

## 1. Where you are

- Run everything from the checkout's root (`git rev-parse --show-toplevel`).
- Canonical remote: `upstream` when it exists (`git remote get-url upstream`), else `origin`.
  Base branch: `ci.baseBranch` from `hassan-devkit config:show --json` (default `main`).
- `git status --porcelain`: uncommitted work is normal in this workflow (work stays uncommitted
  until the user asks to commit). Note the paths; you will check them against the incoming
  change in step 3.

## 2. Fetch and short-circuit

```sh
git fetch <remote> <base>
git merge-base --is-ancestor <remote>/<base> HEAD && echo up-to-date
```

Up to date → report that and stop.

## 3. Preview what comes in

```sh
git log --oneline HEAD..<remote>/<base>
git diff --stat HEAD...<remote>/<base>
```

- If an incoming path is also modified and uncommitted locally, stop and tell the user which
  paths collide: git would refuse the merge, and stashing or committing their work is their
  call, not yours.
- Note whether the lockfile (`pnpm-lock.yaml`), any `package.json` or the devkit / lint presets
  move: these decide step 5.

## 4. Merge

- On the base branch itself (a main checkout): `git merge --ff-only <remote>/<base>` and skip
  to step 6 — the base branch never gets a merge commit.
- On a ticket branch: `git merge --no-edit <remote>/<base>`. A clean merge commits by itself
  without running the pre-commit hook; nothing more to do here.
- Conflicts: resolve them (the `resolving-merge-conflicts` skill), `git add` the resolved
  files, then do step 5 BEFORE `git commit`.

## 5. Install before completing a conflicted merge

Completing a conflicted merge is a `git commit`, so the pre-commit hook runs lint-staged's
`prettier --write` and `eslint --fix` over every staged upstream file — with the toolchain in
this checkout's CURRENT `node_modules`. When the incoming change bumps the devkit or a lint
preset, the stale local preset rewrites upstream's files (it strips a directive it does not
know, reformats with old options) and the hook aborts the commit listing them.

1. When the lockfile or a `package.json` came in: `pnpm install --frozen-lockfile --prefer-offline`.
2. `git commit --no-edit` (a merge commit is exempt from the commit-subject standard and needs
   no `commit-writer` plan).
3. If the hook still aborts with "rewrote staged files": for each listed file that you did NOT
   resolve by hand, restore upstream's version — `git checkout <remote>/<base> -- <file>`; for a
   file you did resolve, review the rewrite (`git diff --cached -- <file>`) and keep it if it is
   only the merged presets doing their job. Then `git commit --no-edit` again.

## 6. Refresh what the merge touched

- Lockfile or `package.json` moved and step 5 did not install: `pnpm install --frozen-lockfile --prefer-offline`.
- Dev servers running in containers do not pick up new files of source-shared libs on their own:
  restart the affected ones with the project's `docker:dev:restart-*` scripts named in its
  `CLAUDE.md`.
- Generated contracts (API spec, generated clients/types): regenerate them the way the
  project's `CLAUDE.md` prescribes when their sources came in, and check for drift with the
  project's `*:check` script.
- `hassan-devkit ci:doctor` when the devkit range moved.

## 7. Report

One short message: the range merged (`<old>..<new>`, count of commits), whether conflicts were
resolved and in which files, whether `pnpm install` ran, and what the user still has to do
(restart, regenerate, re-run a build). Do not push.
