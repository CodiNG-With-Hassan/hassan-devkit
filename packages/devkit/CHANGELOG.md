# @coding-with-hassan/devkit

## 1.0.0-next.0

### Major Changes

- 1cef7a1: Foundation of the 1.0 line — the way of working as a versioned package (design: `docs/design/way-of-working.md`, ADR 0001).
  - **Config contract**: the `hassan-devkit` block of the root `package.json` gains `worktree`, `tracker` (`jira` | `github` | `none`), `commits`, `ci` and `testCases` sections with defaults and validation (`hassan-devkit config:check`). Unknown keys are rejected so a typo cannot silently disable a feature.
  - **Derivation instead of declaration**: workspace projects (name = directory basename, kind `api` | `spa` | `lib`) come from `pnpm-workspace.yaml`; commit scopes = project names + `commits.extraScopes`; compose profile → service and buildable-image maps come from `docker compose config`; the dev image tag is a content hash of the lockfile, workspace file, every `package.json` and every `docker/Dockerfile*.dev`; the canonical remote is `upstream` when present.
  - **`hassan-devkit init`**: idempotent scaffold — config skeleton + default scripts merged into `package.json` (adds only missing keys), the slot-0 managed block in `.env.dist` (fixed `DEVKIT_*` keys), and the `scripts/pre-commit-extra.sh` seam. `--dry-run` previews, `--force` overwrites edited files after printing a diff.
  - **`config:show`** / **`commits:show`** (`--json`): declared + derived values in one place; the commit-subject regex `^<TICKET> (<types>)\((<scopes>)\): [a-z]` that CI and the commit-writer agent share.
  - Tests: `node --test` on the pure logic (config, derivation, env block, scaffold, init).

  The `major` bump starts the `1.0.0-next.*` prereleases (changesets pre mode); no existing command changes behaviour in this release.

### Minor Changes

- 9bc8fc2: Tracker adapters for `worktree:create`, selected by `hassan-devkit.tracker.kind`:
  - `jira` (`project`, optional `baseUrl`): assigns the branch's ticket to the current user and moves a `To Do` ticket to `In Progress`; credentials from `JIRA_EMAIL`/`JIRA_API_TOKEN`/`JIRA_URL` in the environment or `~/.config/jira/env`. Best effort — every failure is a `note:`.
  - `github` (`prefix`, default `GH`): branch `GH-<n>-Title` → `gh issue edit <n> --add-assignee @me` on the base repo (`upstream`, else `origin`). No status change: the open PR is the progress signal. Commit subjects use `GH-<n>`; PR bodies end with `Closes #<n>`.
  - `none`: no-op.

  `hassan-devkit init` now also renders `docs/agents/issue-tracker.md`, `triage-labels.md` and `domain.md` from the tracker config (managed files: regenerated on every init) so the engineering skills find the right endpoints and label vocabulary.

- e9f4caa: `worktree:*` — parallel-development worktrees with isolated Docker stacks, ported from car-rental's `scripts/worktree.sh` to Node:
  - `worktree:create <branch> [--profiles a,b] [--no-up]`: prunes merged worktrees, fetches the canonical remote (`upstream`, else `origin`), adds the worktree off its `main`, allocates the lowest free slot under a cross-checkout lock, writes the managed `.env` block (`DEVKIT_*` keys, ports = base + slot×10), runs the tracker hook, `pnpm install`, bootstraps husky (hard failure when `.husky/_/pre-commit` is missing — git silently skips hooks otherwise), builds only the images the tag lacks, starts the stack, waits for `worktree.ready.url`, runs `worktree.seeds`.
  - `worktree:env [--slot N]`: refresh the current checkout's block keeping slot + profiles; refuses a slot another checkout holds; drops `node_modules` volumes of stale tags. `docker:up` runs it implicitly when `worktree` is configured.
  - `worktree:profiles list|add|remove`: profiles come from the compose file; `worktree.profiles.required` cannot be removed.
  - `worktree:remove [--keep-data] [--force]`, `worktree:prune [--dry-run]` (PR state via `gh pr list --head`, only MERGED removes; dirty trees are never force-removed), `worktree:list` (duplicate-slot warning).
  - A repo without `docker/docker-compose.dev.yml` gets worktrees without a stack (no `.env`, no slot).
  - Image tag inputs now include the Dockerfiles of the compose file's buildable services.

## 0.4.0

### Minor Changes

- e0c3f05: Add an optional `docker.preUp` hook to the `hassan-devkit` config block. When set, `docker:up` runs that shell command from the repo root before `docker compose up -d --build`, and aborts the up if it exits non-zero. Projects use it to refresh values their compose file reads from `.env` on every up (e.g. an image tag derived from the lockfile, or the active compose profiles), so those can never go stale:

  ```json
  {
    "hassan-devkit": {
      "docker": { "preUp": "scripts/worktree.sh env" }
    }
  }
  ```

## 0.3.0

### Minor Changes

- 93c918b: Add an `i18n:check` command that validates translation JSON across a project's languages: it flags keys missing from any language file and enforces UPPERCASE_SNAKE_CASE key naming. Configure via the `hassan-devkit.i18n` block in package.json (`dir`, `languages`; defaults `public/assets/i18n` and `["en", "nl"]`), and it is wired into the shared pre-commit hook (no-op when a project has no i18n directory). This centralizes the previously copy-pasted per-project `check-translations` script.

## 0.2.0

### Minor Changes

- 0cb02c2: Switch `db:*` and `docker:restart` commands to address services through `docker compose exec <service>` instead of hardcoded container names. This means client repos no longer need to set `container_name:` in their compose file or repeat the brand prefix on every service — the compose project name does the disambiguation.

  **Breaking change** to the `hassan-devkit` config block in `package.json`:

  ```diff
   "hassan-devkit": {
     "db": {
  -    "container": "de-autozaak-db",
  +    "service": "db",
       "user": "postgres",
       "name": "de_autozaak"
     }
   }
  ```

  `docker:restart` now takes a compose service name (e.g. `api`) instead of a hardcoded container name (e.g. `de-autozaak-api`).

## 0.1.0

### Minor Changes

- 3b38c23: Initial public release.
  - Shared ESLint flat configs for NestJS (`@coding-with-hassan/eslint-config-api`) and Angular (`@coding-with-hassan/eslint-config-spa`), exposed as factory functions so consumers pass `tsconfigRootDir` / selector `prefix`.
  - Prettier presets for both stacks.
  - Project-aware `lint-staged` factory for monorepos with an API and SPA folder side by side.
  - Renovate preset that groups `@coding-with-hassan/*`, Angular, NestJS, PrimeNG, NgRx, and TypeORM bumps into meaningful PRs.
  - `@coding-with-hassan/devkit` CLI with `docker:*`, `db:*`, and `hooks:*` commands, plus a ships-from-package husky pre-commit hook so the hook content itself updates via dependency bumps.
