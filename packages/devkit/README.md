# @coding-with-hassan/devkit

The way of working of Hassan's client projects as one versioned package: parallel git worktrees with isolated Docker stacks, the pre-commit chain, a CI job with commit standards and an Nx cache, the Claude Code standards/agents/hooks, and the bilingual acceptance-test workbooks. A project installs it, fills one config block in `package.json`, runs `hassan-devkit init`, and picks up every later standard by bumping the version. Design: `docs/design/way-of-working.md`; decisions: `docs/adr/`.

New projects start from [hassan-devkit-template](https://github.com/CodiNG-With-Hassan/hassan-devkit-template), which is exactly what `init` produces on an Nx `apps/*` + `libs/*` pnpm workspace.

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

- one `@import` line in the project's `CLAUDE.md` (`.claude/CLAUDE.md` when it exists) pulling `node_modules/@coding-with-hassan/devkit/claude/standards.md` — Docker via scripts, worktrees, commit/push consent + commit-writer, tickets, the acceptance-case quality gate, lint/format/CI parity, domain docs. In-repo imports load at launch without an approval dialog;
- `.claude/agents/commit-writer.md` as a **stub** whose body says "read the shipped file and follow it" — the stub never changes, the content ships with the devkit version;
- one `.claude/skills/<name>/SKILL.md` stub per skill, same pattern: the house `implement-ticket` (body shipped by the devkit) and every skill of the project's `mattpocock-skills` dependency — `init` adds `github:mattpocock/skills#v1.2.3` to `devDependencies`, a GitHub tarball pinned to an upstream release tag that pnpm integrity-locks — except `implement` and `setup-matt-pocock-skills`, which the house skill and `init` replace. The stub copies the skill's frontmatter verbatim (user-invocable-only skills stay user-only) and points at the body under `node_modules`. Stubs are derived on every install and **gitignored** through a managed block, so nothing is committed and a bump changes nothing in git; they are what makes the skills reach every clone and the skill pickers that only scan `.claude/skills` (T3 Code). Renovate bumps the tag (the shared preset automerges it), so an upstream skills release needs no devkit release;
- the PR-assignee `PreToolUse` deny hook merged idempotently into `.claude/settings.json`.

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
