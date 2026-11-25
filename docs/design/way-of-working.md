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
| 10 | Shipped house rules: workflow, quality gate, lint/format + Nx, domain docs + tracker adapters. Amended with GH-71: grilling rounds are asked through the question dialog, and a house rule wins over a skill body (see "Shipped rules"). |
| 11 | Template repo is rewritten to the Nx layout via `hassan-devkit init`; bridal-store untouched. Amended with GH-57: the template is a maintained repo in the shape of a real project, not `init` output (see "Template rewrite"). |
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
  "tracker": { "kind": "jira", "project": "DAZ", "baseUrl": "https://inventorie.atlassian.net",
               "transitions": { "prOpened": "In Review", "merged": "Acceptance" } },   // default; null turns one off
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
  "docker": { "preUp": null },                                              // existing; worktree env now runs implicitly
  "design": { "url": "https://claude.ai/artifact/…" }                       // the design system `sync-theme` reads (GH-59); optional
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
| `create <BRANCH> [--profiles a,b] [--no-up]` | `prune` first; fetch `upstream`/`origin`; worktree off `<remote>/main` (reuse an existing branch); allocate the lowest free slot under a lock; write `.env`; tracker hook; `pnpm install`; `pnpm exec husky` and hard-fail if `.husky/_/pre-commit` is missing; build missing images under the build lock; `compose up`; wait for `worktree.ready.url`; run `worktree.seeds`; print URLs. Once the worktree exists, its stack is set up from its own `package.json` and compose file (ports, profiles, `ready`, `seeds`, `env`): the invoking checkout may be behind `<remote>/main`, so it only supplies `baseDir` and `maxSlot`, and a note names the `worktree` keys on which the two differ. The seed step always prints what it did (`seeding: …`, `no seed scripts configured`, or `not seeding: …`). No compose file → the stack steps are skipped (this repo dogfoods that path). |
| `env [--slot N]` | Recompute the managed block for the current checkout keeping slot + profiles; refuse a slot another checkout holds; build missing images; drop `node_modules` volumes of stale tags; warn on missing `node_modules` / `.husky/_`. `docker:up` runs this implicitly when `worktree` is configured, so the `docker.preUp` hook is no longer needed for it. |
| `profiles list\|add\|remove` | Mutate `COMPOSE_PROFILES`; `add` ups the new services, `remove` stops them; `profiles.required` cannot be removed. |
| `stop` | `compose stop` across all profiles for the current checkout: the containers stop and stay, with their volumes, the slot and `.env`, so `docker:up` starts the same stack again. Only a stack managed for this checkout is stopped: no compose file, a missing or skeleton `worktree` block (the stack may be shared between checkouts) or no `.env` (the compose project would not be this checkout's own) → the reason is printed, nothing is stopped, exit 0. It is the one `worktree:*` command that does not fail on a missing `worktree` block. A failed stop exits 1. The `open-pr` skill runs it once the PR is open (GH-73). |
| `remove <name> [--keep-data] [--force]` | Stack down (`-v` unless `--keep-data`) across all profiles, `git worktree remove`, GC unreferenced image tags. Branch kept. |
| `prune [--dry-run]` | For every worktree ask `gh pr list --repo <base> --head <branch> --state all` (never `pr view`, which cannot see fork heads); only `MERGED` removes stack, worktree and branch, and then reports `merged` to the tracker for the removed worktree's ticket. Dirty worktrees are never force-removed. |
| `list` | `git worktree list` + slot/ports/profiles/tag per checkout + duplicate-slot warnings. |

Locks: `mkdir`-based with pid reclaim, `.slot.lock` (120 s) and `.image-build.lock` (1800 s)
under `worktree.baseDir`, never nested.

### Tracker adapters (`core/tracker/`)

| kind | on `worktree:create` | PR opened / PR merged | credentials |
|---|---|---|---|
| `jira` | `GET /myself` → `PUT /issue/<key>/assignee`; if status is `To Do`, transition to `In Progress`. Best effort: every failure is a `note:` and exit 0. | Move the ticket to `tracker.transitions.prOpened` (default `In Review`) / `.merged` (default `Acceptance`); `null` turns one off. Same best effort. | `~/.config/jira/env` (`JIRA_EMAIL`, `JIRA_API_TOKEN`, optional `JIRA_URL`/`JIRA_BASE_URL`) or the same names in the environment |
| `github` | `gh issue edit <n> --add-assignee @me` when the branch starts with `<PREFIX>-<n>`. Nothing else: the open PR is the progress signal. | nothing | `gh auth` |
| `none` | nothing | nothing | — |

The ticket follows its PR through two events, in lifecycle order `prOpened` → `merged`.
`tracker:transition <ticket> <prOpened|merged>` reports one (the ticket is a key or a branch
name starting with it): the `open-pr` skill reports `prOpened` once the PR is open, and
`worktree:prune` reports `merged` for the ticket of every worktree it removes. The jira adapter
reads the ticket's status, then looks the transition up by target
status name among the ticket's available transitions (`GET /issue/<key>/transitions`,
`to.name`). A ticket already in the target status, in a done status, or in the target status
of a later event is left alone: a workflow that allows every transition would otherwise let a
late `prOpened` pull a ticket back out of `Acceptance`. Jira does not expose the order of a
workflow's statuses, so any other status counts as before the target. A wrong event name is a
usage error (exit 1); every tracker failure is a `note:` and exit 0.

The adapter also produces `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`
(see Claude layer) so the mattpocock skills find the right endpoints and label vocabulary.

### `tickets:graph [--epic <KEY>] [--out <file>]` (GH-54)

The ticket dependency chart as a Mermaid flowchart, so deciding what to start next is one
command, not a prompt per project. Each adapter gains a read operation, `readTickets`, that
returns tickets (key, title, status category, epic), epics (key, title) and blocking edges
(blocker → blocked); everything after that is pure (`core/tickets/graph.js`).

| kind | read operation |
|---|---|
| `jira` | `POST /search/jql` for the issues of the project that are not done, then a second search for the issues that block them (done ones, other projects' ones) so they come with their epic. Edges are `Blocks` links, the epic is the parent, the status category is the status's own category. Sub-tasks are left out. |
| `github` | `gh issue list --state open`, then one `gh issue view` per issue an open one names as blocker or epic. Edges are `Blocked by #<n>` body lines (also `Blocked by: #1, #2` and the `## Blocked by` section of the upstream ticket template; never a mention inside a sentence or a code fence); the epic is the `Part of #<n>` line or the `## Parent` section; closed is done, open with an assignee is in progress (starting a ticket assigns it), open without one is to do. |
| `none` | none: the command exits 0 with a note. |

- **Scope**: every ticket that is not done, plus the tickets that block them directly. A done
  blocker one hop away stays visible as the reason a ticket is ready; done work further back is
  out. `--epic` narrows the first set to one epic and keeps the direct blockers from any epic.
- **Ready ticket**: not started, and everything that blocks it is done. Computed on the links
  as read, before scope and reduction, so a blocker that is not a node — an epic, an issue that
  could not be read — still blocks until it is known to be done.
- **Transitive reduction**: an edge that a longer path already implies is dropped. Edges go one
  at a time against what is left, so reachability survives links that form a cycle. A path does
  not count when it runs through a done ticket: dropping the direct edge would leave the blocked
  ticket with nothing but finished work in front of it.
- **Chart**: tickets without an epic first, then one subgraph per epic; nodes classed `todo`,
  `inProgress`, `done`, and `ready` in place of `todo`. Titles are cut to 60 characters and kept
  from being read as markup or Markdown (Mermaid 11 prints "Unsupported markdown" in the node
  for a code span or a link); an epic title carries no break opportunity, because a wrapped
  subgraph title is drawn over the nodes.
- **Output**: the chart on stdout, notes on stderr, and a Markdown page (chart, colour key, the
  ready tickets by name) in `docs/tickets/dependencies.md`. The path is in the managed
  `.gitignore` block, so the chart is never committed; `--out` writes elsewhere (`.mmd` /
  `.mermaid`: the chart alone).
- Unlike `startTicket`, the read is not best effort: without the tracker there is no chart, so
  a failure exits 1. Only a single referenced issue that cannot be read is a `note:`.
- Tests cover edge parsing, the issue → ticket mappings, scope, ready detection, the reduction
  and the rendering from fixtures; none calls a tracker.

The command sees links only. An **unlinked dependency**, one that a ticket description states
and no link records, is found by reading prose, which is a judgment: that part is the house
skill `ticket-graph` (GH-55), not adapter code. The skill runs the command, reads the
descriptions of the tickets on the chart, redraws the chart with the unlinked dependencies as
dashed edges and lists each with the sentence it came from. A dependency is not proposed when
the tracker already links it, when the chart implies it through a path of unfinished tickets
(the reduction would drop that edge anyway), or when a done ticket, an epic or a sub-task sits
at either end. The skill then asks which ones to record; that answer is the only consent for a
tracker write. A confirmed dependency becomes the link the adapter reads (jira: a `Blocks` link
with the blocker as inward issue; github: a `Blocked by #<n>` line appended to the issue body),
and the command runs again, which also verifies the write: the dependency comes back as a solid
arrow or a path of unfinished tickets, and one the chart's scope leaves out is read back from
the tracker. The write stays in the skill (`gh`, the Jira issue-link call) and adds no adapter
operation: it happens once per confirmed link, in front of the user.

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
`.gitignore` block that keeps them, and the `tickets:graph` chart, out of git — except a skill the project wrote itself at
that path (any `SKILL.md` that is not a stub), which is kept, stays committed and is reported
with a note until the project deletes it; merges the two house hook entries into
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
  shipped in the package (`add-error-code`, `implement-ticket`, `merge-upstream`, `open-pr`, `project-setup`, `sync-theme`, `ticket-graph`) and the mattpocock skills, which the PROJECT
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
- **House rules over skill bodies** (GH-71): the upstream `grilling` body prints each round as
  numbered text and waits for a typed reply, while Claude Code has a question dialog (the
  `AskUserQuestion` tool) that is faster to answer and was only used when the user asked for
  it in the session. The round format lives in one upstream file (`grill-me` and
  `grill-with-docs` are wrappers, other skills start a grilling session as a step), so one
  rule covers every session. That rule is in `standards.md` because the standards are the
  only devkit content loaded on both paths: a project stub (`/grill-with-docs`) reads the
  pinned dependency, the plugin-qualified name (`/mattpocock-skills:grill-with-docs`) reads
  the developer's plugin copy and never touches the stub. Three alternatives were rejected.
  An amendment appended to the generated grill stubs misses the plugin path, and an amended
  stub no longer matches `isSkillStub`, so the next install would take it for the project's
  own copy. A house `grilling` skill forks the body and stops receiving upstream changes
  through Renovate. Changing the skill upstream does not fit: the dialog is a Claude Code
  tool and the upstream skills target other agents too. The rule quotes no upstream wording,
  since the round format changes between releases, and it replaces only how a question is
  put to the user. Because the stubs say "follow it exactly", the standards state the
  precedence once, for every rule: where a house rule and a skill body differ, the house rule
  wins, and whatever the rule does not touch in the skill stands.
- **`open-pr`** (GH-53): the one house skill that commits and pushes, and one of the two with
  `disable-model-invocation: true` (the other is `project-setup`). The consent rule needs the user's own words in the current
  request; a skill Claude cannot start turns typing `/open-pr` into exactly that, for the
  commits, the push and the PR in one go, so the prompt that closed every ticket (bring `main`
  in, fix the conflicts, run the checks, commit, push, open the PR) is no longer typed by hand.
  It composes what exists: the `merge-upstream` skill, `ci:check` and
  `ci:affected` on the working tree (pending work is checked before it is committed), the
  `commit-writer` plan, `git push`, `gh pr create --assignee @me` with the title from the
  branch's ticket and short title and the body from the `pr` skill ending with the tracker's
  ticket reference (an open PR gets its body rewritten for the branch as it is now), then
  `tracker:transition <ticket> prOpened`, then `worktree:stop` (GH-73). It stops at the first
  failure and reports it, and refuses to run on the base branch. The stack is stopped because
  a PR waiting for review needs no running containers, and Docker memory is shared by every
  session on the machine. It is stopped, not removed: review feedback often needs the same
  data again, so removal stays with `worktree:prune` once the PR is merged. The stop is the
  last step, so a failed check or push leaves the stack running for the fix, and a failed stop
  is reported without failing the skill, because the PR is already open. One reordering:
  when uncommitted work collides with what the merge brings in, a bare `merge-upstream` stops. Here the ask for the commits is already
  given, so the pending work is checked and committed first, then merged, and the checks run
  again on the merged result: nothing is committed unchecked. The `pr` skill ships with `mattpocock-skills` from v1.3; a project on an older
  tag gets a plain body (what changed and why, how it was verified, what to review).
- **`sync-theme`** (GH-59): a project's theme starts from a Claude design system, and turning
  that into the theme library was redone by prompt for each project and again at every design
  change. It is a skill and adds no command: mapping a brand's tokens onto a PrimeNG preset is
  a judgment (which colour is the primary ramp, which step carries text), not a transformation
  a script can own. The one thing declared is the link, `design.url`, because it is the only
  input that cannot be derived; the skill asks for it once and stores it, so a re-run after a
  design change needs no question. Everything else is found: the theme library and the
  frontends from `config:show --json`, the values from the design system's `tokens.json`, its
  README and its uploaded assets, read through the artifact tool (the link is private, a web
  fetch gets the sign-in page). Two rules keep a re-run safe. The design system gives every
  value and the project keeps its structure, so a token goes only where the theme or the base
  preset already has a key for it; one with no counterpart is reported, and growing the theme
  stays the user's decision. And nothing is guessed: an unreadable design system stops the
  skill, a logo is copied and never redrawn, and a value the skill had to compute (a ramp
  from a single brand colour, through `palette()`) is listed as derived. It is model-invocable
  because it writes to the working tree only: it stops on the base branch, runs
  `ci:affected` and never commits.
- **`project-setup`** (GH-60): starting a project repeated the same setup after "Use this
  template": rename everything, wire the tracker, write the glossary, apply the design system,
  configure the repository, open the setup PR. The skill takes a fresh clone to its
  **setup PR** and adds no command, because every part is either a judgment (which occurrence
  of `template` is the placeholder and which an Angular template, what the brief's terms mean)
  or a skill that exists (`grill-with-docs`, `sync-theme`, `open-pr`).
  - **User-typed only.** It writes outside the working tree: a ticket in the tracker, a
    worktree, the repository's settings. Typing `/project-setup` is the ask for those. It is
    not an ask for commits: the skill ends by telling the user to type `/open-pr`, so the
    consent rule keeps its one exception. It is the ask for `grill-with-docs`, which is
    user-typed only upstream: the skill reads that body and follows it, since a model cannot
    invoke it.
  - **Re-runnable.** Every step opens with a check of whether it is already done (the setup
    worktree exists, the config holds the project's names, the glossary is written and the
    project's `CLAUDE.md` says so, the repository settings read back as wanted). The last
    step, the checks, runs on every run. The setup ticket's description is the record between runs:
    it holds the answers and the concept brief, so a second run asks nothing twice.
  - **Order.** Ticket and worktree first, then the rename inside the worktree, so the rename
    is ticket work like any other. The worktree is created with `--no-up`: a stack started
    before the rename would build its images under the template's names. It starts after the
    rename, and the API spec is regenerated from it because the spec carries the API title.
  - **Ports.** The project's base ports are the template's plus one offset. Slot n adds
    n × 10, so two base ports collide when they differ by a multiple of 10 that is at most
    `maxSlot` × 10; the skill takes the first offset, in steps of 100, whose ports collide with
    none of the projects checked out next to this one. A fixed step per project is not enough:
    1200 above the template puts the API on the customer site's port. Only the host side
    moves; inside the compose network every service keeps its standard port.
  - **Generated files.** The lockfile, the managed block of `.env.dist` and `docs/agents/*.md`
    (`init --only env,agents`), the API spec with its packages and the acceptance workbooks are
    regenerated from the renamed sources, never edited.
  - **Repository settings.** Merge commits as the only merge method, because a squash or a
    rebase rewrites the commits and drops their signatures and standard subjects, and delete
    branch on merge. Branch rules are left alone: private repositories on the free plan do not
    have them. The template's own Renovate rule, the one that merges devkit bumps unattended,
    is removed from `renovate.json` unless the user wants it. Installing the Renovate app needs
    an app-authorised token, so the skill gives the user the link and goes on.
  - **Known wart.** `worktree.baseDir` is one of the renamed keys, and the devkit finds
    worktrees by listing that folder. The setup worktree is created under the template's
    folder, so after the merge it must be pruned from the main checkout before `main` is
    brought in; the skill's report says so, together with what the merge does not reach (the
    main checkout's own `.env`, a Jira ticket's `merged` transition). Finding worktrees through `git worktree list`
    would remove the ordering, and is not part of this change.
  It stops at the setup PR: specs and tickets follow with `to-spec` and `to-tickets`, and
  deployment configuration is the project's own.
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
   `hassan-devkit worktree:create` off `<remote>/main`; a stack is stopped (`worktree:stop`)
   once its PR is open and removed (`worktree:prune`) once it is merged; never commit or push
   without the user's explicit ask in the current request (finishing a task, an approved plan or a skill's
   instruction is not consent; push needs its own ask; typing `/open-pr`, which only the user
   can start, is the explicit ask for the commits, the push and the PR); plan every commit with the
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
5. **Grilling through the question dialog** (GH-71) — in a grilling session, whichever skill
   started it, every round and the closing confirmation are asked through Claude Code's
   question dialog, not as the text format of the skill body: the options are the answers,
   the recommended one first and the real alternatives with their trade-offs after it; every
   question is self-contained; a round of more than four questions is several dialogs in one
   turn; the skill's own text format is the fallback where the dialog is not available. Where
   a house rule and a skill body differ, the house rule wins.

Project specifics (framework rules, lib conventions, deployment) stay in the project's CLAUDE.md
below the import line.

## Template rewrite

`hassan-devkit-template` is a maintained repository with the shape new projects actually start
from (GH-57). It is no longer the output of `hassan-devkit init` on an empty Nx workspace: that
gave the way of working but no application, so new projects were scaffolded by hand from the
newest existing one instead. `init` keeps its role for adopting the devkit in an existing
workspace, and `ci:doctor` holds the template's scaffolded files to the installed devkit like
any project's.

- **Apps**: `apps/api` (NestJS with the error-code contract), `apps/web-admin` (Angular staff
  app, browser-only) and `apps/web-customer` (Angular customer site, server-side rendered).
- **Libs**, all consumed as source: `api-types` and `api-client` (generated from the committed
  OpenAPI spec), `i18n` (the language list and the `ERRORS` catalog), `theme` (a PrimeNG preset
  with a neutral placeholder ramp, which the `sync-theme` skill replaces from the project's
  design system), `web-ui` (logo, theme and language switches, field errors,
  the `translateError` pipe), `shared-utils` and `assets`.
- **Stack**: the compose file with profiles (`api` by default, `customer`, `admin`, `extras`)
  and `DEVKIT_` ports, one dev Dockerfile per app, the scaffolded CI workflow, the shared
  Renovate preset, and one bilingual acceptance case per frontend.
- **Placeholders**: the project name `template`, the ticket key `TPL` (GitHub tracker, so the
  template's own issues are `TPL-<n>`), the package `tpl-i18n` and the default host ports. A new
  project renames them with the `project-setup` skill (GH-60).
- **No project copy of a house skill**: `add-error-code` comes from the devkit (GH-56); the
  template keeps only `.claude/rules/api-errors.md`, which that skill reads for the project's
  own names.
- **It follows the devkit by itself**: its CI runs the commit standard, format, lint and
  production builds on every pull request, and its `renovate.json` automerges
  `@coding-with-hassan/*` bumps when that CI is green. A devkit release that breaks the template
  shows up there as a red pull request.
- **The devkit follows it too** (GH-58): the `template` job of this repo's CI fails a devkit
  pull request that breaks the template, before anything is released. It checks out the
  template's `main`, packs every publishable workspace package (`pnpm pack`, what the release
  ships), points the template at the tarballs through pnpm overrides in its
  `pnpm-workspace.yaml`, installs, and runs the template's own `format:check`, `lint` and
  `build` (production) plus `hassan-devkit ci:doctor`. Every check runs even after one failed.
  The logic is `scripts/template-check.mjs`, so the same run works locally against a throwaway
  clone: `pnpm template:check <path>` (it rewrites that clone's workspace file and lockfile).
  The job runs on the template's toolchain (its pnpm, its Node).
  - A change that needs a matching template change says so in its pull request and lands the
    template change first: the job always reads the template's `main`.
  - One change cannot land template-first: a new workflow skeleton. The template's own
    `ci:doctor` rejects it until the devkit that renders it is released, so that pull request
    shows the `template` job red on the doctor step, and the template follows with
    `hassan-devkit init --force` once the release is out.

"Use this template" yields a repository that reaches a running stack with `pnpm install` and
`pnpm docker:dev:up` only. bridal-store stays on the flat layout and the old commands.

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
`pnpm docker:dev:up` only. (These were the criteria 1.0.0 was released on. Since GH-57 the
template is maintained by hand, see "Template rewrite"; the fresh-clone criterion still holds.)

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
