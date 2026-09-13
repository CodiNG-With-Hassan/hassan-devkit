# @coding-with-hassan/devkit

CLI that wraps the developer workflow shared across Hassan's client projects: docker compose orchestration, postgres helpers, and the husky pre-commit hook.

## Install

```sh
pnpm add -D @coding-with-hassan/devkit
```

## Configure

Add a `hassan-devkit` block to your client repo's root `package.json` so the db commands know which compose service to address:

```json
{
  "hassan-devkit": {
    "db": {
      "service": "db",
      "user": "postgres",
      "name": "de_autozaak"
    }
  }
}
```

`service` is the docker-compose service name, **not** a hardcoded container name. The CLI runs `docker compose exec <service>`, so the project name in your compose file handles disambiguation when multiple client stacks share a host.

The docker commands assume `docker/docker-compose.dev.yml` and a `.env` file at the repo root (the convention the template repo ships with).

Optionally add a `docker.preUp` hook — a shell command `docker:up` runs from the repo root right before `docker compose up`. Use it to refresh values your compose file reads from `.env` (image tags derived from the lockfile, compose profiles, ports) so they can never go stale between ups; a non-zero exit aborts the up:

```json
{
  "hassan-devkit": {
    "docker": { "preUp": "scripts/worktree.sh env" }
  }
}
```

## Wire it into your scripts

```json
{
  "scripts": {
    "docker:dev:up": "hassan-devkit docker:up",
    "docker:dev:down": "hassan-devkit docker:down",
    "docker:dev:logs": "hassan-devkit docker:logs",
    "db:list-tables": "hassan-devkit db:list-tables",
    "db:psql": "hassan-devkit db:psql",
    "prepare": "hassan-devkit hooks:install"
  }
}
```

## The way of working (1.0 line)

From 1.0 the CLI is the single delivery vehicle for the whole way of working — parallel worktrees with isolated stacks, the pre-commit chain, CI with commit standards, and the Claude Code layer. Design: `docs/design/way-of-working.md` and ADR 0001 in this repo. New features assume an **Nx `apps/*` + `libs/*` pnpm monorepo**; the `docker:*`, `db:*` and `hooks:*` commands above stay layout-agnostic.

### Configure once, derive the rest

Everything a project declares lives in the `hassan-devkit` block of the root `package.json` (validated by `hassan-devkit config:check`, unknown keys are rejected):

```jsonc
"hassan-devkit": {
  "worktree": {
    "baseDir": "../my-app-worktrees",           // default ../<root-name>-worktrees
    "projectName": "my-app",                    // compose project of slot 0
    "ports": { "api": 3000, "db": 5432, "web": 4200 },   // base host ports; slot N adds N*10
    "profiles": { "default": ["api"], "required": ["api"] },
    "seeds": { "service": "backend", "scripts": ["seed:admin-user"] },
    "ready": { "url": "http://localhost:${DEVKIT_PORT_API}/api-json" },
    "env": { "API_PROXY_TARGET": "http://localhost:${DEVKIT_PORT_API}" }
  },
  "tracker": { "kind": "jira", "project": "DAZ", "baseUrl": "https://x.atlassian.net" },
  //        | { "kind": "github", "prefix": "GH" } | { "kind": "none" }
  "commits": { "docsUrl": "https://…/Git+Workflow" },   // types/extraScopes/requireSigned/exemptAuthors have defaults
  "ci": { "checks": [{ "name": "translations", "paths": ["^libs/i18n/"], "run": "pnpm exec nx run-many -t check-translations" }] },
  "testCases": { "dir": "docs/testing", "languages": ["en", "nl"] }
}
```

Never declared, always derived:

| Fact | Source |
|---|---|
| Workspace projects (name = dir basename, kind `api` / `spa` / `lib`) | `pnpm-workspace.yaml` globs → dirs with a `package.json`; `nest-cli.json` / `angular.json` decide the kind |
| Commit scopes | project names + `commits.extraScopes` (default `docker, workspace, docs, deps`) |
| Compose profile → services / buildable images | `docker compose --profile '*' config` |
| Dev image tag | sha256 of lockfile, workspace file, every `package.json`, every `docker/Dockerfile*.dev` |
| Canonical remote | `upstream` when present, else `origin` |

Managed `.env` values use fixed keys: `COMPOSE_PROJECT_NAME`, `COMPOSE_PROFILES`, `DEVKIT_IMAGE_TAG`, `DEVKIT_SLOT`, `DEVKIT_BRANCH`, `DEVKIT_PORT_<KEY>` (one per `worktree.ports` entry, upper snake case) plus the expanded `worktree.env` extras. Compose files reference `${DEVKIT_PORT_API}` etc.

### Commands

- `hassan-devkit init [--dry-run] [--force]` — idempotent scaffold: merges the config skeleton and default scripts into `package.json` (adds only missing keys), writes the slot-0 managed block into `.env.dist`, creates the `scripts/pre-commit-extra.sh` seam. Files the project edited are kept unless `--force`, which prints a diff first. Re-run after editing the config to refresh `.env.dist`.
- `hassan-devkit config:show [--json]` — declared + derived values (projects, scopes, compose profiles, image tag).
- `hassan-devkit config:check` — validate the block; exit 1 with the offending paths.
- `hassan-devkit commits:show [--json]` — the commit-subject contract shared by CI and the commit-writer agent: ticket token, types, derived scopes and the regex `^<TICKET> (<types>)\((<scopes>)\): [a-z]`.

### Worktrees

One worktree per ticket, each with its own Docker stack (own compose project, host ports = base + slot×10, own volumes), sharing the dev images with every checkout on the same dependency manifest. Worktrees live under `worktree.baseDir` (default `../<root-name>-worktrees`); slot 0 is the main checkout. A repo without `docker/docker-compose.dev.yml` gets worktrees without a stack.

- `hassan-devkit worktree:create <BRANCH> [--profiles a,b] [--no-up]` — prune merged worktrees, fetch `upstream`/`origin` `main`, add the worktree off it, allocate the lowest free slot (under a lock), write the managed `.env`, run the tracker hook, `pnpm install`, bootstrap husky (fails loudly if `.husky/_/pre-commit` is missing), build the images the tag lacks, `up`, wait for `worktree.ready.url`, run `worktree.seeds`.
- `hassan-devkit worktree:env [--slot N]` — refresh this checkout's managed block (keeps slot + profiles, recomputes the image tag, builds missing images, drops stale `node_modules` volumes). Refuses a slot another checkout holds. `docker:up` runs it implicitly.
- `hassan-devkit worktree:profiles list|add|remove <names>` — the compose profiles this stack runs (derived from the compose file; `worktree.profiles.required` cannot be removed).
- `hassan-devkit worktree:remove <BRANCH> [--keep-data] [--force]` — stack down (volumes deleted unless `--keep-data`), worktree removed, branch kept, unreferenced image tags garbage-collected.
- `hassan-devkit worktree:prune [--dry-run]` — remove every worktree whose PR is merged (`gh pr list --head`, base repo = `upstream`); dirty trees are never force-removed.
- `hassan-devkit worktree:list` — worktrees with slot, ports, profiles, image tag; warns on duplicate slots.

### Tracker adapters (`tracker.kind`)

| kind | on `worktree:create` | credentials |
| --- | --- | --- |
| `jira` | assign the branch's `<PROJECT>-<n>` ticket to you; `To Do` → `In Progress` | `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_URL` from the environment or `~/.config/jira/env` |
| `github` | `gh issue edit <n> --add-assignee @me` on the base repo for a `<PREFIX>-<n>-…` branch; PR bodies end with `Closes #<n>` | `gh auth` |
| `none` | nothing | — |

All best effort: a missing token or unreachable tracker prints a `note:` and never blocks the worktree. `init` renders `docs/agents/issue-tracker.md`, `triage-labels.md` and `domain.md` from this config for the engineering skills.

### Pre-commit chain

`hassan-devkit hooks:install` (wired as the `prepare` script, so it runs on every `pnpm install` in every checkout) installs husky, (re)creates its per-checkout shim dir and writes the shared `.husky/pre-commit`:

1. `scripts/pre-commit-extra.sh` — the project's own guards (optional; must exit 0)
2. `hassan-devkit i18n:check` — flat projects' translation keys (no-op otherwise)
3. `hassan-devkit ci:doctor` — only when `.github/workflows/ci.yml` is staged
4. `lint-staged` — targets derived from the workspace:

```js
// lint-staged.config.mjs
import lintStaged from '@coding-with-hassan/devkit/lint-staged';
export default lintStaged({ exclude: ['api-client'], extra: { 'scripts/**/*.mjs': ['prettier --write'] } });
```

Every project with an ESLint/Prettier config gets `pnpm -C <dir> exec …` entries (api: `**/*.ts`; spa/lib: `src/**/*.{ts,html}` and `src/**/*.{scss,css,json}`). No project list to maintain.

`hassan-devkit ci:doctor` fails when the installed devkit does not satisfy the declared range (stale `node_modules`), when the config block is invalid, or when the husky shims are missing.

`ci:*` (commit standards, Nx cache, affected), the Claude layer and `test-cases:generate` land in the following prereleases — see the design doc for their contracts.

## Commands

### Docker

- `hassan-devkit docker:up` — runs the `docker.preUp` hook when configured, then `docker compose up -d --build`
- `hassan-devkit docker:down` — `docker compose down`
- `hassan-devkit docker:logs` — tail logs
- `hassan-devkit docker:restart <service>` — `docker compose restart <service>`

### Database

- `hassan-devkit db:list-tables` — `\dt`
- `hassan-devkit db:describe <table>` — `\d <table>`
- `hassan-devkit db:count <table>` — `SELECT COUNT(*) FROM <table>`
- `hassan-devkit db:truncate <table>` — `TRUNCATE TABLE <table> CASCADE`
- `hassan-devkit db:psql` — interactive psql shell

### i18n

- `hassan-devkit i18n:check` — validates translation JSON: flags keys missing from any language file and enforces UPPERCASE_SNAKE_CASE key naming. Add `--detailed` (per-module key counts) or `--detailed --show-keys` to inspect. No-ops when the project has no i18n directory, and runs automatically in the shared pre-commit hook.

  Configure via the `hassan-devkit.i18n` block in package.json (both fields optional):

  ```json
  {
    "hassan-devkit": {
      "i18n": { "dir": "public/assets/i18n", "languages": ["en", "nl"] }
    }
  }
  ```

  `dir` is resolved from the repo root — in a monorepo point it at the app (e.g. `spa/public/assets/i18n`). Defaults: `public/assets/i18n` and `["en", "nl"]`.

### Husky hooks

- `hassan-devkit hooks:install` — installs husky if needed, then writes the shared `pre-commit` hook content into `.husky/pre-commit`. Re-run after bumping `@coding-with-hassan/devkit` to pick up changes to the hook.
- `hassan-devkit pre-commit` — runs the hook body directly. Used internally; the installed `.husky/pre-commit` file invokes this.
- `hassan-devkit hooks:print` — print the hook content to stdout (for inspection / diffing).

### Per-project extras

If a project needs to run something extra before the standard `i18n:check` + lint-staged steps, drop a `scripts/pre-commit-extra.sh` in the repo root. It runs first, must `exit 0` to continue. (Translation consistency is now built in via `i18n:check` — see above — so it no longer belongs here.)
