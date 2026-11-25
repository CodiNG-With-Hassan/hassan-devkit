# @coding-with-hassan/devkit

The way of working of Hassan's client projects as one versioned package: parallel git worktrees with isolated Docker stacks, the pre-commit chain, a CI job with commit standards and an Nx cache, the Claude Code standards/agents/hooks, and the bilingual acceptance-test workbooks. A project installs it, fills one config block in `package.json`, runs `hassan-devkit init`, and picks up every later standard by bumping the version. Design: `docs/design/way-of-working.md`; decisions: `docs/adr/`.

New projects start from [hassan-devkit-template](https://github.com/CodiNG-With-Hassan/hassan-devkit-template): a maintained Nx `apps/*` + `libs/*` pnpm workspace in the shape of a real project (a NestJS API with the error-code contract, an Angular staff app, a server-rendered Angular customer site and the shared libs), already wired to this package. It reaches a running stack with `pnpm install` and `pnpm docker:dev:up`, and typing `/project-setup` in the fresh clone takes it to its setup PR (see [Claude Code layer](#claude-code-layer)). `init` is for adopting the devkit in a workspace that already exists.

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

## Wire it into your scripts (flat repos; Nx workspaces get this from `init`)

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

## The way of working

Everything below assumes an **Nx `apps/*` + `libs/*` pnpm monorepo** (the template's shape); the `docker:*`, `db:*`, `i18n:check` and `hooks:*` commands further down stay layout-agnostic for the older flat repos. Requires Node ≥ 22.13.

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
  "tracker": { "kind": "jira", "project": "DAZ", "baseUrl": "https://x.atlassian.net",
               "transitions": { "prOpened": "In Review", "merged": "Acceptance" } },   // optional, these are the defaults; null turns one off
  //        | { "kind": "github", "prefix": "GH" } | { "kind": "none" }
  "commits": { "docsUrl": "https://…/Git+Workflow" },   // types/extraScopes/requireSigned/exemptAuthors have defaults
  "ci": { "checks": [{ "name": "translations", "paths": ["^libs/i18n/"], "run": "pnpm exec nx run-many -t check-translations" }] },
  "testCases": { "dir": "docs/testing", "languages": ["en", "nl"] },
  "design": { "url": "https://claude.ai/artifact/…" }   // the project's design system; the `sync-theme` skill reads it, and stores the link when it is missing
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
- `hassan-devkit format:file <...files>` — format files as the pre-commit hook would, ahead of the commit: the Prettier commands of the project's `lint-staged.config.*` (fallback: the derived config) whose globs match each file, run from the repo root. One status line per file (`formatted`, `unchanged`, `no-formatter`, `missing`, `outside`, `failed`); exit 1 only when a formatter failed. The Claude `post-edit` hook is its main caller.

### Worktrees

One worktree per ticket, each with its own Docker stack (own compose project, host ports = base + slot×10, own volumes), sharing the dev images with every checkout on the same dependency manifest. Worktrees live under `worktree.baseDir` (default `../<root-name>-worktrees`); slot 0 is the main checkout. A repo without `docker/docker-compose.dev.yml` gets worktrees without a stack.

- `hassan-devkit worktree:create <BRANCH> [--profiles a,b] [--no-up]` — prune merged worktrees, fetch `upstream`/`origin` `main`, add the worktree off it, allocate the lowest free slot (under a lock), write the managed `.env`, run the tracker hook, `pnpm install`, bootstrap husky (fails loudly if `.husky/_/pre-commit` is missing), build the images the tag lacks, `up`, wait for `worktree.ready.url`, run `worktree.seeds`. The stack is set up from the new worktree's own `package.json` and compose file (ports, profiles, `ready`, `seeds`, `env`), not from the checkout the command is run in, which may be behind the remote `main`; only `baseDir` and `maxSlot` are read from that checkout, and a note names the `worktree` keys on which the two differ. The seed step always prints a line: `seeding: pnpm <script> (service <service>)` before each script, `no seed scripts configured (worktree.seeds.scripts)` for an empty list, `not seeding: …` when scripts are configured and the stack was not started. A failing seed script fails the command.
- `hassan-devkit worktree:env [--slot N]` — refresh this checkout's managed block (keeps slot + profiles, recomputes the image tag, builds missing images, drops stale `node_modules` volumes). Refuses a slot another checkout holds. `docker:up` runs it implicitly.
- `hassan-devkit worktree:profiles list|add|remove <names>` — the compose profiles this stack runs (derived from the compose file; `worktree.profiles.required` cannot be removed).
- `hassan-devkit worktree:stop` — stop the stack of the checkout it is run from (`docker compose stop` across every profile) and keep everything: containers, volumes, slot and `.env`. `pnpm docker:dev:up` starts the same stack again. It stops only a stack the devkit manages for that checkout: without a compose file, with an empty `worktree` block or without a `.env` it says why, stops nothing and exits 0. A stop that fails exits 1. `/open-pr` runs it once the PR is open.
- `hassan-devkit worktree:remove <BRANCH> [--keep-data] [--force]` — stack down (volumes deleted unless `--keep-data`), worktree removed, branch kept, unreferenced image tags garbage-collected.
- `hassan-devkit worktree:prune [--dry-run]` — remove every worktree whose PR is merged (`gh pr list --head`, base repo = `upstream`) and report `merged` to the tracker for its ticket; dirty trees are never force-removed.
- `hassan-devkit worktree:list` — worktrees with slot, ports, profiles, image tag; warns on duplicate slots.

### Tracker adapters (`tracker.kind`)

| kind | on `worktree:create` | PR opened / PR merged | credentials |
| --- | --- | --- | --- |
| `jira` | assign the branch's `<PROJECT>-<n>` ticket to you; `To Do` → `In Progress` | move the ticket to `tracker.transitions.prOpened` (default `In Review`) / `.merged` (default `Acceptance`) | `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_URL` from the environment or `~/.config/jira/env` |
| `github` | `gh issue edit <n> --add-assignee @me` on the base repo for a `<PREFIX>-<n>-…` branch; PR bodies end with `Closes #<n>` | nothing: an open PR stays the progress signal | `gh auth` |
| `none` | nothing | nothing | — |

- `hassan-devkit tracker:transition <TICKET> <prOpened|merged>` — report a PR event for a ticket (a key, or a branch name starting with it). The jira adapter moves the ticket to the status `tracker.transitions` names for the event, looked up by target status name among the ticket's available transitions; a ticket already in or past that status is left alone, and a key set to `null` turns the transition off. Run it with `prOpened` after opening the PR (the `open-pr` skill does); `worktree:prune` reports `merged` itself for the ticket of every worktree it removes.

All best effort: a missing token or unreachable tracker prints a `note:` and never blocks the worktree or fails the command (in `tracker:transition`, an unknown event name is a usage error and exits 1). `init` renders `docs/agents/issue-tracker.md`, `triage-labels.md` and `domain.md` from this config for the engineering skills.

### Ticket dependency chart (`tickets:graph`)

`hassan-devkit tickets:graph [--epic <KEY>] [--out <file>]` reads the configured tracker and prints the ticket dependencies as a Mermaid flowchart: what blocks what, and what can be started next.

- **Scope**: every ticket that is not done, plus the tickets that block them directly, so a done blocker one hop away stays visible. `--epic DAZ-241` (a bare `241` or `#241` works too) narrows to one epic and keeps the blockers from other epics.
- **Chart**: one subgraph per epic, an arrow from a blocker to the ticket it blocks, nodes coloured by status category (to do, in progress, done). **Ready tickets** — not started, every blocker done — are highlighted; a blocker that is not a node (an epic, an issue that could not be read) still counts until it is done. An edge that a longer path of unfinished tickets already implies is dropped (transitive reduction), so a project-wide chart stays readable.
- **Output**: the chart on stdout (everything else goes to stderr, so it pipes) and a Markdown page around it — chart, colour key, the ready tickets by name — in `docs/tickets/dependencies.md`. That path is in the managed `.gitignore` block (written by `init` and on every install); the chart is never committed. `--out <file>` writes somewhere else, relative to the cwd; a `.mmd` / `.mermaid` file gets the chart alone.

| kind | tickets | blocking edges | epic | status category |
| --- | --- | --- | --- | --- |
| `jira` | the issues of `tracker.project` that are not done, plus the issues blocking them; sub-tasks are left out | `Blocks` issue links | the parent | the status's own category |
| `github` | the open issues of the base repo, plus the issues they reference | `Blocked by #<n>` lines in the body (`Blocked by: #1, #2` and a `## Blocked by` section count too; a mention inside a sentence or a code fence does not) | the `Part of #<n>` line or `## Parent` section | closed is done, open with an assignee is in progress, open without one is to do |
| `none` | — the command exits with a note | | | |

Credentials are those of the adapters above. Unlike the `worktree:create` hook this is not best effort: a tracker that cannot be read fails the command.

**Unlinked dependencies (the `ticket-graph` skill).** The chart shows the dependencies the tracker holds as links; one that is only stated in a ticket description is missing from it, and the ticket it blocks can look ready. The house skill `ticket-graph` covers that gap. Asking Claude for the ticket graph, what blocks what or what to start next triggers it (or type `/ticket-graph`):

1. It runs `tickets:graph`, with `--epic` when you named one, and shows the chart.
2. It reads the descriptions of the tickets on the chart and looks for dependencies that have no link. One that is already linked, that the chart implies through a path of unfinished tickets, or that has a done ticket at either end is left out.
3. It shows the chart again with those as dashed edges and lists each with the sentence it came from.
4. It asks which ones to record. The confirmed ones become the links the command reads — a `Blocks` link in Jira, a `Blocked by #<n>` line appended to the GitHub issue body — and the command runs again, which shows whether each write landed.

Nothing is written to the tracker before that answer, and only the dependencies you picked are recorded.

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

Every project with an ESLint/Prettier config gets `pnpm -C <dir> exec …` entries (api: `**/*.ts`; spa/lib: `src/**/*.{ts,html}` and `src/**/*.{scss,css,json}`). No project list to maintain. The same config drives `hassan-devkit format:file`, so what Claude's `post-edit` hook formats on edit is exactly what the hook would have rewritten at commit time.

The hook never rewrites silently. lint-staged re-stages the fixes `eslint --fix` / `prettier --write` applied, so the hook snapshots the staged tree (`git write-tree`) before and after it runs: when the tree changed, the commit is **aborted** and the rewritten files are listed — the tree that gets committed and pushed must be one that was built and tested (an auto-fix such as `type` → `interface` can break a production build that was green locally). Fixers cascade (Prettier reformats what `eslint --fix` produced only on the next run), so lint-staged is re-run until the staged tree is stable (at most three extra passes) before the files are listed. The fixes stay staged: review them (`git diff --cached`), rebuild what they touch, then run the same `git commit` again — the second attempt on the unchanged tree passes. Clean commits pass in one go with no extra output.

`hassan-devkit ci:doctor` fails when the installed devkit does not satisfy the declared range (stale `node_modules`), when the config block is invalid, or when the husky shims are missing.

### CI (`ci:*`)

`init` scaffolds a thin `.github/workflows/ci.yml` for Nx workspaces (Node from `ci.nodeVersion`, base branch `ci.baseBranch`, exempt authors from `commits.exemptAuthors`). The file only sequences these commands, so a devkit bump changes what CI does without touching it; `ci:doctor` fails when the file drifts from the installed template (`init --force` refreshes it).

- `hassan-devkit ci:commit-standards [--repo o/r --pr n]` — every non-merge PR commit must match `hassan-devkit commits:show` and, with `commits.requireSigned`, be Verified on GitHub. PRs by `commits.exemptAuthors` skip the check. Needs `GH_TOKEN`.
- `hassan-devkit ci:cache attach|detach` — move Nx's task cache between `.nx` and the cacheable `.nx-ci-cache` folder, re-homing the machine-id-named index so restored entries are actually hit.
- `hassan-devkit ci:check [--base --head]` — `ci:doctor`, then `format:check` for the projects owning a changed file (content files included), then every `ci.checks[]` whose `paths` regex matches a changed file runs its `run` command.
- `hassan-devkit ci:affected [--targets lint,build] [--base --head] [--with-content] [--dry-run]` — graph targets (`build`) for touched projects and dependents, own-files targets (`lint`, `format:check`) only for projects owning a changed file; files no target reads (docs, `ci.affected.contentOnly`) are dropped first; `ci.affected.adopted` maps files outside any project to the project whose target reads them — an adopted file always counts, even under `docs/` or a `contentOnly` glob (e.g. `"docs/testing/*.ts": "daz-i18n"` for acceptance-case data a lib's `format:check` covers).

### Claude Code layer

`hassan-devkit claude:install` (run by `prepare` and by `init`) wires the house standards into Claude Code without copying content:

- one `@import` line in the project's `CLAUDE.md` (`.claude/CLAUDE.md` when it exists) pulling `node_modules/@coding-with-hassan/devkit/claude/standards.md` — Docker via scripts, worktrees, commit/push consent + commit-writer, tickets, the acceptance-case quality gate, lint/format/CI parity, domain docs, grilling rounds asked through the question dialog; where a house rule and a skill body differ, the house rule wins. In-repo imports load at launch without an approval dialog;
- `.claude/agents/commit-writer.md` as a **stub** whose body says "read the shipped file and follow it" — the stub never changes, the content ships with the devkit version;
- one `.claude/skills/<name>/SKILL.md` stub per skill, same pattern: the house skills `add-error-code`, `implement-ticket`, `merge-upstream`, `open-pr`, `project-setup`, `sync-theme` and `ticket-graph` (bodies shipped by the devkit; all model-invocable except `open-pr` and `project-setup`, which are user-typed only — `merge-upstream` runs only when the user asks to bring `main` in or fix a PR's conflicts, since that ask is the consent for the merge commit; `open-pr` takes a ticket branch from finished work to an open PR, see below; `project-setup` takes a fresh template clone to its setup PR, see below; `add-error-code` names no project: it finds the API app, the i18n lib and the frontends from `hassan-devkit config:show --json` and follows the error-code contract from there; `sync-theme` derives the theme library from the project's design system, see below; `ticket-graph` is described under [Ticket dependency chart](#ticket-dependency-chart-ticketsgraph)) and every skill of the project's `mattpocock-skills` dependency — `init` adds `github:mattpocock/skills#v1.2.3` to `devDependencies`, a GitHub tarball pinned to an upstream release tag that pnpm integrity-locks — except `implement` and `setup-matt-pocock-skills`, which the house skill and `init` replace. The stub copies the skill's frontmatter verbatim (user-invocable-only skills stay user-only) and points at the body under `node_modules`. Stubs are derived on every install and **gitignored** through a managed block (which also lists the `tickets:graph` chart), so nothing is committed and a bump changes nothing in git; they are what makes the skills reach every clone and the skill pickers that only scan `.claude/skills` (T3 Code). A `SKILL.md` the project wrote itself at one of those paths (anything that is not a stub) is the project's own copy: it is neither overwritten nor gitignored, and `claude:install` prints a note until the folder is deleted, after which the stub takes over. Renovate bumps the tag (the shared preset automerges it), so an upstream skills release needs no devkit release;
- two managed hook entries merged idempotently into `.claude/settings.json`, both running `hassan-devkit claude:hook <id>` from the checkout's `node_modules` (recognised by that id, so a reworded command replaces the entry and the inline `jq` hook of devkit ≤ 1.2 is dropped): `pre-bash` (`PreToolUse` on `Bash`) denies `gh pr create` without `--assignee`, `docker compose` run directly, `git worktree add|remove|prune|…` and `git commit` on `ci.baseBranch` — each with the house command to use instead; `post-edit` (`PostToolUse` on `Edit|Write|MultiEdit`) runs `format:file` on the edited file and tells Claude to re-read it when Prettier changed it. The rules live in the package, so a bump adds a guard with nothing to re-commit; every hook fails open (a broken hook never blocks a tool call).

**`/open-pr`** closes a ticket's work in one user-typed step. The skill has `disable-model-invocation: true`, so Claude can never start it: typing it is the explicit ask for the commits, the push and the PR that the consent rule requires. In order, stopping at the first failure and reporting it:

1. the `merge-upstream` skill (canonical `main` in, conflicts resolved);
2. `hassan-devkit ci:check` and `hassan-devkit ci:affected`, on the working tree, so pending work is checked before it is committed (and checked again when the pre-commit hook rewrote a staged file);
3. the pending work committed through the `commit-writer` plan (skipped when there is none);
4. `git push -u origin <branch>`, never forced;
5. no open PR for the branch: `gh pr create --assignee @me`, titled `<TICKET> <Short title>` from the branch name, with a body written with the `pr` skill and ending with the tracker's ticket reference (`Closes #<n>` for GitHub); a PR already open: its body rewritten for the branch as it is now;
6. `hassan-devkit tracker:transition <TICKET> prOpened`;
7. `hassan-devkit worktree:stop`: the checkout's stack is stopped while the PR waits for review, so it no longer holds Docker memory. Nothing is removed (`worktree:prune` does that once the PR is merged), and `pnpm docker:dev:up` starts it again when review feedback needs it. A failed stop is reported and does not fail the skill;
8. the PR link.

It refuses to run on the base branch. When uncommitted work collides with what the merge brings in, a bare `merge-upstream` stops; here the ask for the commits is given, so the pending work is checked and committed first, then merged, and the checks run again on the merged result. The `pr` skill ships with `mattpocock-skills` from v1.3; on an older tag the body is a plain one (what changed and why, how it was verified, what to review).

**`sync-theme`** keeps the theme library in line with the project's design system, so the translation is no longer redone by prompt for each project and again at every design change. Asking Claude to sync or update the theme, the brand colours, the fonts or the logo from the design system triggers it (or type `/sync-theme`):

1. It takes the design system link from `hassan-devkit.design.url`. When the key is missing it asks for the link and stores it in the root `package.json`, so the next run needs no question.
2. It reads the design system (a Claude design system, read through the artifact tool): colours per colour scheme, typography, radii, spacing and the logo assets.
3. It updates the PrimeNG preset of the theme library, the font setup of every frontend and their logo and favicon. Values come from the design system, the structure stays the project's; a logo is copied, never redrawn. Nothing is at a fixed path: the theme library and the frontends are found through `hassan-devkit config:show --json`.
4. It runs `hassan-devkit ci:affected`, updates the acceptance cases that state what changed (a brand name, a logo) and reports four lists: what changed, what it derived (a ramp from a single brand colour), what in the design system has no counterpart in the preset, and what the theme keeps that the design system says nothing about.

It runs in a ticket worktree like any other change, stops on the base branch and never commits. A design token the theme has no place for is reported, not given a new token group: growing the theme stays your decision. A design system that cannot be read stops the skill; no value is guessed.

**`/project-setup`** turns a repository freshly created from the template into its project, up to the **setup PR**. Run it once, in the fresh clone after `pnpm install`. Like `/open-pr` it has `disable-model-invocation: true`: it writes outside the working tree (a ticket, a worktree, the repository's settings), so only you can start it. Every step first checks whether it is already done, so after an interruption you type it again and it continues where it stopped (the last step, the checks, runs on every run):

1. It asks for the project name, the tracker (a Jira project, or GitHub issues with a ticket key), the languages and a concept brief (a file or pasted text). It derives the slug, the database name and a set of host ports that collide with none of the projects checked out next to it, and shows them for correction.
2. It creates the setup ticket in the tracker, with the answers and the brief as its description, and the setup worktree: `hassan-devkit worktree:create <TICKET>-Project-Setup --no-up`.
3. It renames the template's placeholders in that worktree: the `hassan-devkit` config block, the project name (`template`, `Template`), the ticket key (`TPL`, and with it the `tpl-i18n` package), the host ports and the languages. Generated files are regenerated, not edited: the lockfile, the managed block of `.env.dist` and `docs/agents/*.md` (`hassan-devkit init --only env,agents`), the API spec and its packages (from the worktree's own stack, which starts here under the project's name), the acceptance workbooks.
4. It runs the `grill-with-docs` skill on the concept brief, which writes `CONTEXT.md` and an ADR for each decision the brief forces. `grill-with-docs` is user-typed only; typing `/project-setup` is the ask for it here.
5. It runs the `sync-theme` skill (skipped, and reported, when there is no design system yet).
6. It sets the repository settings: merge commits as the only merge method (a squash or a rebase drops the commits' signatures and standard subjects) and delete branch on merge. Branch rules are not set: they are unavailable on private repositories on the free plan. For Renovate it removes the template's own automerge rule from `renovate.json` and gives you the link to add the repository to the Renovate app, which a personal token cannot do.
7. It runs `hassan-devkit ci:check` and `hassan-devkit ci:affected`, then reports and hands over: you type `/open-pr` for the setup PR.

It never commits or pushes. Its report ends with what to do once the setup PR is merged: run `hassan-devkit worktree:prune` in the main checkout before bringing `main` in, because the setup worktree was created under the template's `worktree.baseDir` and the devkit stops looking there once the project's own config is in. The report also names what the merge does not reach: the main checkout's own `.env`, and with a Jira tracker the ticket's `merged` transition. Specs and tickets come after it, with the `to-spec` and `to-tickets` skills; deployment configuration is out of scope.

Project-specific rules stay in the project's own `CLAUDE.md` below the import. A devkit bump therefore changes what Claude does with nothing to re-commit.

### Acceptance test cases (`test-cases:generate`)

The quality gate for application code is the bilingual acceptance-case set in `docs/testing/` (`testCases.dir`), not unit tests. Data files `tc-data-<suite>.ts` export `*_AREAS`, `*_KNOWN_ISSUES` and `*_README`; the shared vocabulary comes from the package:

```ts
import { tc, type Area, type KnownIssue, type Readme } from '@coding-with-hassan/devkit/test-cases';
```

`hassan-devkit test-cases:generate [--lang xx] [--testers file.json]` writes `test-cases-<suite>-<lang>.xlsx` per suite and language (`testCases.languages`, default `en`, `nl`; workbook UI strings ship for those two) next to the data, plus a personalised copy per tester (Tester column prefilled, credentials in the Read Me sheet). Each workbook has a Read Me, a Summary with per-area counts, one sheet per area with a Pass/Fail/Blocked/Skipped dropdown, and a Known Issues sheet. The workbooks are gitignored artifacts; commit the data files with the feature. The data files are TypeScript loaded through Node's built-in type stripping (Node ≥ 22.13, no `tsx`), which keeps import specifiers verbatim — hence the `type` modifiers above. `testCases.title` sets the project name in the Read Me title. `init` scaffolds a starter `tc-data-app.ts` when the section is configured and the directory is empty.

## Upgrading from 0.x

- **Node ≥ 22.13** (the acceptance-case generator loads TypeScript data with Node's type stripping).
- **Config block**: `hassan-devkit.db`, `docker.preUp` and `i18n` keep working; add `worktree`, `tracker`, `commits`, `ci`, `testCases` as needed — `hassan-devkit init --only config` writes the skeleton. Unknown keys are now rejected (`config:check`).
- **`hooks:install`** no longer runs `husky init` (which rewrote your `prepare` script); it (re)creates husky's per-checkout shims and skips inside container builds (`HUSKY=0`, no `.git`). The hook body gained the `ci:doctor` step for staged workflow files; `i18n:check` stays.
- **lint-staged**: replace `@coding-with-hassan/lint-staged-config` with `lint-staged.config.mjs` importing `@coding-with-hassan/devkit/lint-staged` (targets derived from the workspace; `init --only hooks` scaffolds it).
- **`docker:up`** runs `worktree:env` implicitly once `hassan-devkit.worktree` names ports or profiles; a `docker.preUp` hook that only refreshed `.env` can go. Managed `.env` keys are `DEVKIT_SLOT`, `DEVKIT_IMAGE_TAG`, `DEVKIT_BRANCH`, `DEVKIT_PORT_*` — rename them in your compose file.
- **CI**: `init --only ci --force` writes the thin workflow; delete hand-rolled affected/cache scripts. Commit scopes are derived from the workspace (`commits:show`).
- **Claude**: `init --only claude,agents` adds the standards import, the stubs, the PR-assignee hook and regenerates `docs/agents`; trim your `CLAUDE.md` to project specifics.
- **Skills** (1.1): `init --only config` adds the `mattpocock-skills` devDependency; `pnpm install` then writes the skill stubs and the `.gitignore` block, and `claude:install` prints the one-off `git rm --cached` for the `implement-ticket` stub you committed under 1.0. With the plugin still enabled in `~/.claude`, a bare `/grilling` runs the project stub and `/mattpocock-skills:grilling` the plugin (same body).
- **`add-error-code`** (1.5): the skill ships with the devkit. A project with its own committed `.claude/skills/add-error-code/` keeps it, and `claude:install` says so on every install. To switch: `git rm -r .claude/skills/add-error-code`, `pnpm install` (writes the stub and adds the folder to the `.gitignore` block), commit the deletion with `.gitignore`. Keep the project's `.claude/rules/api-errors.md`: the shipped skill reads the project-specific names from it.
- Adopt piece by piece with `init --only <part>`; `ci:doctor` reports what is not adopted yet.

## Layout-agnostic commands

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
