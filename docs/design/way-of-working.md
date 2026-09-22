# The way of working as a versioned package

_Design agreed 2026-09-13 in a grilling session against the car-rental repo. This document is
the spec for the 1.0 line of `@coding-with-hassan/devkit`; each numbered piece maps to one
GitHub issue in this repo and one migration task in the first consumer._

## Goal

A new project installs one package, fills in one config block, and has the complete way of
working that car-rental grew by hand: parallel git worktrees with isolated Docker stacks, a
pre-commit chain, a CI job with commit standards and an Nx cache, and the Claude Code layer
(standards text, agents, skills, hooks). When a standard changes or a new one is added, the
project picks it up by bumping the package version. Nothing else.

## Non-goals

- Supporting layouts other than an Nx package-based pnpm monorepo (`apps/*` + `libs/*`). The
  flat `api/` + `spa/` shape of the current template is not supported by the new features; the
  existing `docker:*`, `db:*` and `hooks:*` commands stay layout-agnostic so bridal-store keeps
  working on bumps.
- Shipping application code (Angular/NestJS scaffolding). The template repo does that.
- A Claude Code plugin. Everything is delivered through npm (see ADR 0001).

## Decisions (from the grilling)

| # | Decision |
|---|---|
| 1 | One npm package (`@coding-with-hassan/devkit`) delivers scripts, CI logic, hooks _and_ the Claude layer. |
| 2 | Scope: worktree lifecycle, CI + commit standards, Claude layer, pre-commit + acceptance-case generator. |
| 3 | Nx `apps/*` + `libs/*` pnpm monorepos only. |
| 4 | car-rental migrates to the package piece by piece (consumer #1, dogfooding). |
| 5 | Config lives in the `hassan-devkit` block of the root `package.json`; whatever can be derived is derived. |
| 6 | Managed `.env` keys use a fixed `DEVKIT_` prefix. |
| 7 | Tracker adapters `jira`, `github`, `none` in 1.0; `prune` always uses `gh` PR state. |
| 8 | CI = thin scaffolded workflow whose steps call `hassan-devkit ci:*`; `ci:doctor` catches skeleton drift. |
| 9 | Claude layer = CLAUDE.md `@import` from `node_modules` + runtime stubs for agents/skills; nothing to re-commit on a bump. |
| 10 | Shipped house rules: workflow, quality gate, lint/format + Nx, domain docs + tracker adapters. |
| 11 | Template repo is rewritten to the Nx layout via `hassan-devkit init`; bridal-store untouched. |
| 12 | 0.x prereleases while car-rental dogfoods; 1.0.0 when car-rental runs fully on the package; semver after. |
| 13 | Order: foundation → worktrees → pre-commit → CI → Claude → acceptance → template → 1.0. |
| 14 | Package work = GitHub issues here, worked in worktrees with the `github` adapter. car-rental migration = one DAZ epic. |
| 15 | GitHub ticket token `GH-<n>` in branches and commit subjects; `Closes #<n>` in the PR body. |
| 16 | The worktree code is ported from bash to Node ESM. |
| 17 | `node --test` on pure logic (derivation, env block, regex, slot math). No tests around docker/gh; the shipped pre-commit hook is the one script run for real — in a throwaway git repo with a stub `pnpm` (amended with GH-40). |
| 18 | GitHub adapter on `worktree:create`: assign `@me` only. |

## Package shape

- Plain Node ESM, `cac` CLI, `child_process` for docker/git/gh/curl. `engines.node >= 20`.
- `packages/devkit/src/`: `commands/` (one file per namespace), `core/` (pure logic, tested),
  `claude/` (shipped markdown), `templates/` (files `init` scaffolds).
- Tests: `node --test packages/devkit/test/**/*.test.js`, wired to the root `pnpm test` that
  CI already runs.
- Releases: changesets as today. Enter pre mode (`changeset pre enter next`) for the 0.x line
  of this work; exit and publish 1.0.0 when the last DAZ migration task is merged.

## Configuration contract

Everything a project declares lives in `package.json → "hassan-devkit"`. The example below is
car-rental after migration; keys marked _derived_ are never written by a project.

```jsonc
"hassan-devkit": {
  "worktree": {
    "baseDir": "../de-autozaak-worktrees",      // default: ../<root-name>-worktrees
    "maxSlot": 30,                                // default 30; slot 0 = main checkout
    "projectName": "de-autozaak",                 // compose project of slot 0; default: sanitized root name
    "ports": {                                    // base host ports; slot N adds N*10
      "api": 3000, "db": 5432, "web": 4200, "admin": 4201,
      "minio": 9000, "minioConsole": 9001, "n8n": 5678,
      "smtp": 1025, "mailpit": 8025, "pgadmin": 5050
    },
    "profiles": { "default": ["api"], "required": ["api"] },
    "seeds": { "service": "backend", "scripts": ["seed:admin-user", "seed:catalog", "seed:colors", "seed:service-catalog"] },
    "ready": { "url": "http://localhost:${DEVKIT_PORT_API}/api-json", "timeoutSeconds": 600 },
    "env": {                                      // extra managed keys, ${DEVKIT_*} expanded
      "FRONTEND_URL": "http://localhost:${DEVKIT_PORT_WEB}",
      "API_PROXY_TARGET": "http://localhost:${DEVKIT_PORT_API}",
      "API_SPEC_URL": "http://localhost:${DEVKIT_PORT_API}/api-json"
    }
  },
  "tracker": { "kind": "jira", "project": "DAZ", "baseUrl": "https://inventorie.atlassian.net" },
  // or: { "kind": "github", "prefix": "GH" }  — repo taken from `gh repo view`
  // or: { "kind": "none" }
  "commits": {
    "types": ["feat", "fix", "refactor", "chore", "docs", "test", "perf"],   // default
    "extraScopes": ["docker", "workspace", "docs", "deps"],                 // default
    "requireSigned": true,                                                  // default
    "exemptAuthors": ["renovate[bot]"],                                     // default
    "docsUrl": "https://inventorie.atlassian.net/wiki/.../Git+Workflow"     // optional, printed on failure
  },
  "ci": {
    "checks": [                                   // path-triggered gates run by `ci:check`
      { "name": "translations",
        "paths": ["^apps/[^/]+/(public|src)/assets/i18n/", "^libs/i18n/", "^libs/api-types/spec/openapi\\.json$",
                  "^apps/api/src/common/(errors/|supported-languages\\.ts$)", "^scripts/(check-[a-z-]*translations\\.mjs|lib/i18n-check-utils\\.mjs)$"],
        "run": "pnpm exec nx run-many -t check-translations" },
      { "name": "api-contract", "paths": ["^(apps/api|libs/api-types|libs/api-client)/"], "run": "pnpm api:types:check" }
    ],
    "affected": { "contentOnly": ["libs/i18n/src/**/*.json", "apps/*/public/assets/i18n/**", "apps/*/src/assets/i18n/**", "libs/assets/src/**"],
                  "adopted": { "scripts/*.mjs": "daz-i18n" } }
  },
  "testCases": { "dir": "docs/testing", "languages": ["en", "nl"] },
  "db": { "service": "db", "user": "postgres", "name": "de_autozaak" },     // existing
  "docker": { "preUp": null }                                               // existing; worktree env now runs implicitly
}
```

### Derived, never declared

| Fact | Source |
|---|---|
| Workspace projects (name = directory basename, kind = `api` \| `spa` \| `lib`) | `pnpm-workspace.yaml` globs → dirs with a `package.json`; kind from `nest-cli.json` / `angular.json` / neither |
| Commit scopes | project names + `commits.extraScopes` |
| Profile → services, profile → buildable images | `docker compose config --format json` (`profiles`, `build`) |
| lint-staged targets | projects with an `eslint.config.*`; `spa`/`lib` get prettier + eslint on `src/**/*.{ts,html}` and prettier on `src/**/*.{scss,css,json}`, `api` gets eslint on `**/*.ts` |
| Dev image name | `<sanitized root name>-dev-<service>:<tag>` |
| Image tag | sha256 of `pnpm-lock.yaml`, `pnpm-workspace.yaml`, every workspace `package.json`, `docker/Dockerfile*.dev*`; first 12 hex chars |
| Ticket key regex | `^<PROJECT>-[0-9]+` (jira) / `^<PREFIX>-[0-9]+` (github) |
| Base repo for PR state | `upstream` remote if present, else `origin` |

Deriving scopes makes the list a superset of car-rental's hand-kept one (`i18n` and
`shared-utils` become valid scopes). That is intended: a lib gets its scope the moment it exists.

## Managed `.env` block

Written atomically by `worktree:env`; everything after the marker is owned by the package, and
owned keys are stripped wherever else they appear. Baseline comes from the checkout's own `.env`,
then the main checkout's, then `.env.dist`.

```
# ── Managed by hassan-devkit (slot 3) — do not edit by hand ──
COMPOSE_PROJECT_NAME=daz-42-fe-some-feature
COMPOSE_PROFILES=api,web
DEVKIT_IMAGE_TAG=3f9c1a0b7e2d
DEVKIT_SLOT=3
DEVKIT_BRANCH=DAZ-42-FE-Some-Feature
DEVKIT_PORT_API=3030
DEVKIT_PORT_DB=5462
…one DEVKIT_PORT_<KEY> per `worktree.ports` entry (upper snake case)…
FRONTEND_URL=http://localhost:4230          ← from worktree.env, expanded
```

Compose files reference `${DEVKIT_PORT_API}` etc. and `${DEVKIT_IMAGE_TAG}`. The
`x-devkit-profiles-guard: ${COMPOSE_PROFILES:?…}` extension field is part of the scaffolded
compose template so an empty profile set fails loudly.

## Commands

### `init`

One-shot scaffold into an existing Nx workspace; idempotent per file (`--force` to overwrite
a file the project has since edited, always showing a diff first). Writes: the config block
skeleton, the managed section of `.env.dist`, the compose profile guard and `DEVKIT_` port
wiring (only when no compose file exists yet), `.github/workflows/ci.yml`, the CLAUDE.md
import line, `.claude/agents` + `.claude/skills` stubs, the `.claude/settings.json` hook,
`docs/agents/*.md`, `lint-staged.config.js`, `scripts/pre-commit-extra.sh` (empty seam),
`docs/testing/` skeleton. Also wires `prepare` to `hooks:install && claude:install`.

### `worktree:*` (port of car-rental `scripts/worktree.sh`)

| Command | Behaviour |
|---|---|
| `create <BRANCH> [--profiles a,b] [--no-up]` | `prune` first; fetch `upstream`/`origin`; worktree off `<remote>/main` (reuse an existing branch); allocate the lowest free slot under a lock; write `.env`; tracker hook; `pnpm install`; `pnpm exec husky` and hard-fail if `.husky/_/pre-commit` is missing; build missing images under the build lock; `compose up`; wait for `worktree.ready.url`; run `worktree.seeds`; print URLs. No compose file → the stack steps are skipped (this repo dogfoods that path). |
| `env [--slot N]` | Recompute the managed block for the current checkout keeping slot + profiles; refuse a slot another checkout holds; build missing images; drop `node_modules` volumes of stale tags; warn on missing `node_modules` / `.husky/_`. `docker:up` runs this implicitly when `worktree` is configured, so the `docker.preUp` hook is no longer needed for it. |
| `profiles list\|add\|remove` | Mutate `COMPOSE_PROFILES`; `add` ups the new services, `remove` stops them; `profiles.required` cannot be removed. |
| `remove <name> [--keep-data] [--force]` | Stack down (`-v` unless `--keep-data`) across all profiles, `git worktree remove`, GC unreferenced image tags. Branch kept. |
| `prune [--dry-run]` | For every worktree ask `gh pr list --repo <base> --head <branch> --state all` (never `pr view`, which cannot see fork heads); only `MERGED` removes stack, worktree and branch. Dirty worktrees are never force-removed. |
| `list` | `git worktree list` + slot/ports/profiles/tag per checkout + duplicate-slot warnings. |

Locks: `mkdir`-based with pid reclaim, `.slot.lock` (120 s) and `.image-build.lock` (1800 s)
under `worktree.baseDir`, never nested.

### Tracker adapters (`core/tracker/`)

| kind | on `worktree:create` | credentials |
|---|---|---|
| `jira` | `GET /myself` → `PUT /issue/<key>/assignee`; if status is `To Do`, transition to `In Progress`. Best effort: every failure is a `note:` and exit 0. | `~/.config/jira/env` (`JIRA_EMAIL`, `JIRA_API_TOKEN`, optional `JIRA_URL`/`JIRA_BASE_URL`) or the same names in the environment |
| `github` | `gh issue edit <n> --add-assignee @me` when the branch starts with `<PREFIX>-<n>`. Nothing else: the open PR is the progress signal. | `gh auth` |
| `none` | nothing | — |

The adapter also produces `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`
(see Claude layer) so the mattpocock skills find the right endpoints and label vocabulary.

### `ci:*`

| Command | Behaviour |
|---|---|
| `ci:commit-standards` | `gh api repos/<repo>/pulls/<n>/commits --paginate`; skip merge commits and `commits.exemptAuthors`; every subject must match `^<TICKET> (<types>)\((<scopes>)\): [a-z]` with scopes derived; `verified` must be true when `requireSigned`. Prints `commits.docsUrl` on failure. |
| `ci:cache attach\|detach` | Port of `scripts/ci-nx-cache.sh`: move `.nx/cache` + the machine-id-named index DB to/from a stageable `.nx-ci-cache/`. |
| `ci:check` | Diff `NX_BASE..NX_HEAD`; run `format:check` through the affected wrapper with content files included; run every `ci.checks[]` whose `paths` match a changed file. |
| `ci:affected [--targets lint,build]` | Port of `scripts/affected.mjs`: graph targets (`build`) via `nx show projects --affected --stdin` on the filtered file list, own-files targets (`lint`, `format:check`) only for projects that own a changed file; `ci.affected.contentOnly` / `adopted` / docs-only filters. |
| `ci:doctor` | Compare `.github/workflows/ci.yml` with the template shipped in this version; exit 1 with a diff when the skeleton is outdated (`init --force` fixes it). Also run from the pre-commit hook when the workflow file is staged. |

The scaffolded workflow (≈40 lines) is exactly: checkout, pnpm, node (`node-version-file:
package.json`), install, `ci:commit-standards` in one job; checkout with history, install,
cache restore, `ci:cache attach`, `nrwl/nx-set-shas`, `ci:check`, `ci:affected`,
`ci:cache detach` (`if: always()`), cache save guarded on a non-empty index in the other.

### `claude:install`

Runs from `prepare`. Writes, only when missing, `.claude/agents/commit-writer.md`; regenerates
on every run one `.claude/skills/<name>/SKILL.md` per skill (stubs, see below) plus the managed
`.gitignore` block that keeps them out of git; merges the two house hook entries into
`.claude/settings.json` (`PreToolUse` on `Bash` → `claude:hook pre-bash`, `PostToolUse` on
`Edit|Write|MultiEdit` → `claude:hook post-edit`; idempotent by id, the inline `jq` PR hook of
≤ 1.2 is dropped), and regenerates `docs/agents/{issue-tracker,triage-labels,domain}.md` from the tracker
config. Adds the `@node_modules/@coding-with-hassan/devkit/claude/standards.md` line to
`.claude/CLAUDE.md` if absent.

### `hooks:install` (changed)

The shipped `pre-commit.sh` becomes: `scripts/pre-commit-extra.sh` if present → `ci:doctor`
if the workflow is staged → `lint-staged`, which never rewrites silently: the staged tree is compared before and after (fixers re-run until stable) and a changed tree aborts the commit listing the rewritten files (GH-40). The `i18n:check` line is dropped (it was a no-op in
the monorepo and is superseded by the project's own `check-translations` targets); the
`i18n:check` command itself stays for flat projects. `lint-staged.config.js` becomes
`module.exports = require('@coding-with-hassan/devkit/lint-staged')()` and derives its targets.

### `test-cases:generate [--lang xx] [--testers file]`

Port of car-rental `docs/testing/generate-test-cases.ts`. Suites are discovered from
`<testCases.dir>/tc-data-*.ts`, each exporting `<SUITE>_AREAS`, `<SUITE>_KNOWN_ISSUES`,
`<SUITE>_README`; the shared types (`tc()`, `Area`, `TestCase`, …) are imported from the
package. Workbook UI strings ship for `en` and `nl`; another language is a package
contribution. Workbooks are written next to the data and stay gitignored.

## Claude layer

### Delivery mechanics

- **Standards text**: `claude/standards.md` in the package, pulled in by one `@import` line
  in the project's `.claude/CLAUDE.md`. In-repo imports load at launch without an approval
  dialog and nest up to four hops, so `standards.md` may itself import per-topic files.
- **Agents and skills**: the project holds stubs whose body is "Read
  `node_modules/@coding-with-hassan/devkit/claude/agents/commit-writer.md` and follow it
  exactly; the ticket prefix, types and scopes come from `hassan-devkit commits:show`". The stub
  never changes; the content does.
- **Skills**: the same stub pattern, one per skill, frontmatter copied verbatim from the body
  (name, description, `disable-model-invocation`, `argument-hint`). Two sources: house skills
  shipped in the package (`implement-ticket`, `merge-upstream`) and the mattpocock skills, which the PROJECT
  installs as the `mattpocock-skills` devDependency — `github:mattpocock/skills#v<tag>`, a GitHub
  tarball pinned to an upstream release tag that pnpm integrity-locks (no git binary, frozen
  installs work) — listed by its plugin manifest minus `implement` and `setup-matt-pocock-skills`.
  Consuming the skills as a Claude Code plugin was rejected: a plugin lives in each developer's
  `~/.claude`, so it reaches neither a fresh clone nor pickers that only scan `.claude/skills`
  (T3 Code); vendoring copies into the devkit was rejected because every upstream change would
  need a devkit release. The stubs are derived on every install and gitignored through a managed
  block, so a bump leaves nothing to commit; Renovate updates the tag (github-tags datasource)
  and the shared preset automerges it. A project stub with the plugin's bare name wins the bare
  slash command while the qualified plugin name still resolves to the plugin (verified against
  the CLI).
- **Hooks**: merged into `.claude/settings.json` (committed, team-wide), not `settings.local.json`.
  The entries only name a dispatcher id (`hassan-devkit claude:hook <id>`); the rules behind them
  are package code (`core/claude-hooks.js`), unit-tested and released like any other rule, so a
  guard reaches every project with a bump and no re-commit. Hooks mirror the standards that need
  no judgment — PR assignee, direct `docker compose`, `git worktree` by hand, a commit on the base
  branch, format-on-edit through `format:file` — and fail open: a hook that cannot decide answers
  nothing. The commit/push consent rule stays prose on purpose: consent is a judgment.
- **Adapters**: `docs/agents/*.md` are generated from config and carry a "generated" header.

### Shipped rules (`claude/standards.md`)

1. **Workflow** — Docker only via the npm scripts; ticket work only in worktrees created by
   `hassan-devkit worktree:create` off `<remote>/main`; never commit or push without the user's
   explicit ask in the current request (finishing a task, an approved plan or a skill's
   instruction is not consent; push needs its own ask); plan every commit with the
   `commit-writer` agent before staging; `gh pr create --assignee @me`; assign the ticket to
   yourself when you start it.
2. **Quality gate** — no unit tests and no test steps in CI for application code; every
   user-facing change ships its bilingual acceptance cases and regenerates the workbooks; run
   the full CI job locally (format, checks, prod builds) before pushing.
3. **Lint/format + Nx** — each app owns its config through the shared presets, never carry one
   app's conventions into another; Nx target inputs are the cache contract; a new workspace
   package goes into every Dockerfile `COPY` list.
4. **Domain docs + tracker** — read `CONTEXT.md` and `docs/adr/` before exploring, use the
   glossary's terms, record decisions as ADRs only when hard to reverse, surprising and a real
   trade-off; use the generated `docs/agents/*.md` adapters.

Project specifics (framework rules, lib conventions, deployment) stay in the project's CLAUDE.md
below the import line.

## Template rewrite

`hassan-devkit-template` becomes an Nx package-based workspace (`apps/api`, `apps/web`, an
empty `libs/`), with the compose file using profiles and `DEVKIT_` ports, produced by running
`hassan-devkit init` on a fresh Nx workspace and committing the result. "Use this template"
then yields the full way of working. bridal-store stays on the flat layout and the old
commands.

## Rollout

### Package (GitHub issues in this repo, worked as `GH-<n>` worktrees)

1. **#7** — Foundation: config reader with derivation, `init`, `node --test` harness, changesets pre mode.
2. **#8** — `worktree:*` ported to Node with `DEVKIT_` env and optional stack.
3. **#9** — Tracker adapters `jira` / `github` / `none` + generated `docs/agents` files.
4. **#10** — Pre-commit: derived lint-staged, new hook body, `ci:doctor` seam.
5. **#11** — `ci:*` commands + scaffolded workflow template.
6. **#12** — Claude layer: `standards.md`, agents/skills content, `claude:install`, settings hook.
7. **#13** — `test-cases:generate`.
8. **#14** — Template rewrite to the Nx layout.
9. **#15** — 1.0.0 release: exit pre mode, README rewrite, migration notes for 0.x consumers.

### car-rental (epic DAZ-241, one Task per step, after all open worktrees are closed)

1. **DAZ-242** — Adopt the config block and `init` output (no behaviour change yet).
2. **DAZ-243** — Replace `scripts/worktree.sh` and `docs/WORKTREES.md` mechanics with `worktree:*`; rename
   `DAZ_*` to `DEVKIT_*` in compose, `.env.dist`, `fetch-spec.mjs` guards and docs.
3. **DAZ-244** — Replace `lint-staged.config.js` with the derived config; drop the manual project list.
4. **DAZ-245** — Replace `.github/workflows/ci.yml`, `scripts/affected.mjs`, `scripts/ci-nx-cache.sh` with the
   scaffolded workflow + `ci:*`; delete the scope mirror from `commit-writer.md`.
5. **DAZ-246** — Import the standards text; turn the agent and skill into stubs; move the PR hook to
   `settings.json`; regenerate `docs/agents`; trim CLAUDE.md to project specifics.
6. **DAZ-247** — Replace `docs/testing/generate-test-cases.ts` with the CLI.
7. **DAZ-248** — Bump to 1.0.0 and remove the `minimumReleaseAgeExclude` prerelease pins.

### 1.0 criteria

car-rental has no hand-rolled counterpart left for any piece above, the template is produced
by `init`, and a fresh clone of the template reaches a running stack with `pnpm install` +
`pnpm docker:dev:up` only.

## Known risks and notes

- The `DAZ_*` → `DEVKIT_*` rename touches the compose file, `.env.dist`, the API spec-fetch
  guard and the docs in one PR; every developer runs `hassan-devkit worktree:env` once afterwards.
- Deriving profile → service maps needs `docker compose config`, i.e. a compose file that
  parses without the stack running. It does today.
- `ci:commit-standards` derives scopes from the workspace at the PR's head, so a PR that adds a
  lib may use the new scope in the same PR (today it needs a `chore(workspace)` commit first).
- The main checkout of car-rental had devkit 0.3.0 installed while `package.json` required
  0.4.0 on 2026-09-13; a stale install silently loses features. `worktree:env` already warns on a
  missing `node_modules`; `ci:doctor` should also compare the installed version with the manifest.
