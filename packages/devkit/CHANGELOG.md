# @coding-with-hassan/devkit

## 1.3.0

### Minor Changes

- f84bcdc: The Claude Code layer grows rails for the house rules that need no judgment, plus a skill for the merge procedure that kept being re-derived:
  - **`hassan-devkit claude:hook <id>`** replaces the inline `jq` PR-assignee hook. `claude:install` now merges two managed entries into `.claude/settings.json` that never change again — `PreToolUse` on `Bash` → `claude:hook pre-bash`, `PostToolUse` on `Edit|Write|MultiEdit` → `claude:hook post-edit` — and drops the legacy `jq` entry on the next install. The rules behind them live in the package, so a devkit bump adds a guard with nothing to re-commit. Every hook fails open: a broken or undecidable hook answers nothing and the tool call proceeds.
  - **`pre-bash` guards**, each denying with the house command to use instead: `gh pr create` without `--assignee`; `docker compose` / `docker-compose` run directly (the root npm scripts apply the managed `.env`); `git worktree add|remove|prune|move|lock|unlock|repair` (the devkit's `worktree:*`; listing passes); `git commit` while the checkout it acts on is on `ci.baseBranch` (honours `git -C <dir>` and a leading `cd <dir> &&`). Guards match only at a command start, so a heredoc or string that merely mentions the phrase passes — the old `jq` hook denied those.
  - **`hassan-devkit format:file <files...>`** formats files the way the pre-commit hook would, ahead of the commit: the Prettier commands of the project's own `lint-staged.config.*` (fallback: the derived config) whose globs match each file, run from the repo root. The `post-edit` hook calls it on every file Claude edits, so the abort-on-rewrite pre-commit hook is left with ESLint fixes only; when Prettier changed the file, the hook tells Claude to re-read it before the next edit. A file Prettier cannot parse mid-edit is reported on stderr and never blocks.
  - **`merge-upstream` house skill** (user-invocable only — it creates the merge commit): fetch the canonical remote's base branch, stop when up to date, fast-forward on the base branch itself, merge on a ticket branch, and — the trap this encodes — `pnpm install --frozen-lockfile` BEFORE completing a conflicted merge so the pre-commit fixers run with the presets upstream was formatted with, restoring any file the hook still rewrote from `<remote>/<base>`; then refresh what the merged files need (dev-server restarts, generated contracts).

## 1.2.0

### Minor Changes

- e479a87: `ci:affected` / `ci:check`: a file matching a `ci.affected.adopted` glob is never dropped by the built-in docs filter or by `contentOnly` — it is read by the mapped project's target, so it selects that project. Previously an entry such as `"docs/testing/*.ts": "daz-i18n"` was dead config because `docs/` was filtered first, and a consumer needed a path-triggered `ci.checks` gate to run `format:check` for acceptance-case data.
- a562067: The shared pre-commit hook aborts the commit when lint-staged rewrote staged files: the staged tree (`git write-tree`) is compared before and after `lint-staged`, the fixers are re-run until the tree is stable (they cascade — Prettier reformats what `eslint --fix` produced only on the next run), and a changed tree exits 1 listing the rewritten files, which stay applied and staged. Review, rebuild, then run the same `git commit` again — the second attempt passes; clean commits pass in one go with no extra output. Why: an `eslint --fix` such as `type` → `interface` used to slip into the commit and fail CI's production build while the local build had been green. Consumers pick it up on `pnpm install` (`hooks:install` rewrites `.husky/pre-commit`).

## 1.1.0

### Minor Changes

- f03a8d0: The mattpocock skills reach every project as a versioned dependency, not a plugin:
  - `init` adds `mattpocock-skills` (`github:mattpocock/skills#v1.2.3`, a GitHub tarball pinned to an upstream release tag) to the root `devDependencies`. pnpm resolves it to an integrity-locked tarball, so no git binary is needed and `--frozen-lockfile` builds keep working.
  - `claude:install` (run by `prepare`) writes one stub per skill: the house `implement-ticket` shipped by the devkit and every skill listed by the installed package's plugin manifest except `implement` and `setup-matt-pocock-skills`, which the house skill and `init` replace. The stub carries the skill's frontmatter verbatim (name, description, `disable-model-invocation`, `argument-hint`), so user-invocable-only skills stay user-only, and points at the body under `node_modules`. Committed stubs were the only way to reach teammates and skill pickers that scan just `.claude/skills` (T3 Code); generated stubs do the same on every install.
  - The stubs are derived, so they are regenerated on every install and gitignored through a managed `# >>> hassan-devkit … # <<< hassan-devkit` block in `.gitignore`. A dependency bump leaves nothing to commit. `claude:install` prints the one-off `git rm --cached` for stubs a project still tracks.
  - Updates flow through Renovate (`github-tags` datasource on the pinned tag); the shared preset automerges them. No devkit release is involved in a skills update.

  Upgrading: run `hassan-devkit init --only config`, `pnpm install`, then the `git rm --cached` the install prints for `.claude/skills/implement-ticket/SKILL.md`. If the plugin is still enabled in `~/.claude`, a bare `/grilling` runs the project stub and `/mattpocock-skills:grilling` the plugin — same body, disable the plugin to see each skill once.

## 1.0.0

### Major Changes

- 1cef7a1: Foundation of the 1.0 line — the way of working as a versioned package (design: `docs/design/way-of-working.md`, ADR 0001).
  - **Config contract**: the `hassan-devkit` block of the root `package.json` gains `worktree`, `tracker` (`jira` | `github` | `none`), `commits`, `ci` and `testCases` sections with defaults and validation (`hassan-devkit config:check`). Unknown keys are rejected so a typo cannot silently disable a feature.
  - **Derivation instead of declaration**: workspace projects (name = directory basename, kind `api` | `spa` | `lib`) come from `pnpm-workspace.yaml`; commit scopes = project names + `commits.extraScopes`; compose profile → service and buildable-image maps come from `docker compose config`; the dev image tag is a content hash of the lockfile, workspace file, every `package.json` and every `docker/Dockerfile*.dev`; the canonical remote is `upstream` when present.
  - **`hassan-devkit init`**: idempotent scaffold — config skeleton + default scripts merged into `package.json` (adds only missing keys), the slot-0 managed block in `.env.dist` (fixed `DEVKIT_*` keys), and the `scripts/pre-commit-extra.sh` seam. `--dry-run` previews, `--force` overwrites edited files after printing a diff.
  - **`config:show`** / **`commits:show`** (`--json`): declared + derived values in one place; the commit-subject regex `^<TICKET> (<types>)\((<scopes>)\): [a-z]` that CI and the commit-writer agent share.
  - Tests: `node --test` on the pure logic (config, derivation, env block, scaffold, init).

  The `major` bump starts the `1.0.0-next.*` prereleases (changesets pre mode); no existing command changes behaviour in this release.

### Minor Changes

- 1941426: `ci:*` — the CI job's logic as CLI commands, so the project's workflow only sequences them and a devkit bump updates what CI does:
  - `ci:commit-standards`: every non-merge PR commit must match the derived commit standard (`commits:show`) and be Verified when `commits.requireSigned`; PRs by `commits.exemptAuthors` are exempt. Reads the PR from the Actions event (or `--repo/--pr`).
  - `ci:cache attach|detach`: Node port of the Nx task-cache dance (re-homes the machine-id-named index so restored entries are hit).
  - `ci:check`: `ci:doctor` → `format:check` for changed projects (content files included) → every `ci.checks[]` whose `paths` match a changed file.
  - `ci:affected [--targets] [--with-content] [--dry-run]`: port of the affected wrapper — graph targets via `nx show projects --affected`, own-files targets by ownership, docs and `ci.affected.contentOnly` dropped, `ci.affected.adopted` honoured.
  - `ci:doctor` also compares `.github/workflows/ci.yml` with the installed template and prints the diff.
  - `init` scaffolds the thin workflow for Nx workspaces from `ci.nodeVersion` (default `24`), `ci.baseBranch` (default `main`) and `commits.exemptAuthors`.

- a5d56cc: The Claude Code layer, delivered without copied content:
  - `claude/standards.md` ships the house rules (Docker via scripts; one ticket = one worktree = one stack; never commit/push without the user's explicit ask in the current request, commit-writer before staging, signed commits, no AI attribution; PR assignee; ticket ownership; acceptance cases instead of unit tests; lint/format/CI parity and Nx input contract; domain docs). The project's `CLAUDE.md` gets one `@import` line pointing at it.
  - `claude/agents/commit-writer.md` and `claude/skills/implement-ticket/SKILL.md` ship the bodies; the project holds stubs that read them at runtime. The commit-writer body takes the ticket token, types and scopes from `hassan-devkit commits:show` — no mirrored lists.
  - `hassan-devkit claude:install` (idempotent; run by `prepare` and by `init`) writes the import line under the H1 of the existing `CLAUDE.md`, the stubs (never overwritten once edited) and merges the PR-assignee `PreToolUse` deny hook into `.claude/settings.json`.
  - `init`'s `prepare` script becomes `hassan-devkit hooks:install && hassan-devkit claude:install` (husky repos) or `hassan-devkit claude:install` (others).

- a3b0871: Pre-commit chain without a hand-kept project list:
  - **`@coding-with-hassan/devkit/lint-staged`** (ESM): `export default lintStaged()` derives the lint-staged targets from the workspace — every project with an ESLint/Prettier config gets `pnpm -C <dir> exec …` entries (api: `**/*.ts`; spa/lib: `src/**/*.{ts,html}` and `src/**/*.{scss,css,json}`, so committed native folders are never touched). `{ extra }` merges entries for files outside any project. Replaces the one-api-one-spa factory of `@coding-with-hassan/lint-staged-config` for Nx workspaces (that package stays for flat repos).
  - **Hook body**: project seam → `i18n:check` → `ci:doctor` when `.github/workflows/ci.yml` is staged → `lint-staged`.
  - **`hooks:install`** now also (re)creates husky's per-checkout shim dir when `.husky/_` is missing and fails loudly when the shims are still absent — git silently skips every hook otherwise. Runs from `prepare`, so every worktree install is covered.
  - **`ci:doctor`** (first version): fails when the installed devkit does not satisfy the range declared in `package.json` (a stale `node_modules` silently loses features), when the config block is invalid, or when `.husky/_/pre-commit` is missing.
  - `init` scaffolds `lint-staged.config.mjs` for husky repos and notes a legacy `lint-staged.config.js` that must be removed (lint-staged reads one config file).

- 2eb8f7b: `test-cases:generate` — the bilingual acceptance-test workbooks as a CLI, ported from car-rental's `docs/testing/generate-test-cases.ts`:
  - `@coding-with-hassan/devkit/test-cases` exports `tc` (positional en/nl case), `tcase` and the types (`Area`, `TestCase`, `KnownIssue`, `Readme`, …) so a project's `tc-data-*.ts` files import their vocabulary from the package.
  - Suites are discovered as `<testCases.dir>/tc-data-<suite>.ts`; each exports `*_AREAS`, `*_KNOWN_ISSUES`, `*_README`. `--lang` restricts the languages (`testCases.languages`, default en + nl), `--testers file.json` adds personalised workbooks. Workbook UI strings ship for `en` and `nl`; `testCases.title` names the project in the Read Me.
  - The TypeScript data files are loaded with Node's built-in type stripping through a small loader hook (no `tsx`); type names must be imported with the `type` modifier. **`engines.node` is now `>=22.13`.**
  - `init` scaffolds a starter `tc-data-app.ts` when `testCases` is configured and the directory has no data yet.

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

### Patch Changes

- 1e4f82b: - **Inert worktree skeleton** (#22): the `worktree` block `init` merges into every package.json is empty until the project fills it in. In a repo with a compose file, that skeleton no longer counts as "worktree configured": `docker:up` does not run the implicit `worktree:env` (which would have managed `.env` next to the project's existing tooling and built a second image set), the `worktree:*` commands fail with an actionable message, and `.env.dist` is left alone. A repo without a compose file is active with `{}`, as before.
  - **`init --only <parts>`** (#23): `config`, `env`, `hooks`, `agents`, `ci`, `claude`, `test-cases` — scaffold one piece at a time when adopting the way of working in an existing repo. Default stays "everything".
- 6ba2341: - `claude:install` skips (with a log line) inside container builds — no `.git` or `HUSKY=0` — instead of writing the Claude stubs into the image; `prepare` keeps working everywhere.
  - Image pruning stays silent when a parallel `worktree:create` already removed the same unreferenced tag.
- f877e9c: - **`hooks:install` is safe inside container builds** (#27): consumers' Dockerfiles run `pnpm install` with the root package.json present, so the root `prepare` script runs where there is no `.git` and `HUSKY=0` is set. The installer now logs and returns without failing in both cases instead of asserting husky's shim directory. It also stops using `husky init`, which rewrote the consumer's `prepare` script to plain `husky`; the shims are created with `pnpm exec husky` when missing.
  - **`ci:doctor` only diffs a devkit-scaffolded workflow** (#28): a hand-written `.github/workflows/ci.yml` (no scaffold marker) is reported as "ci part not adopted yet", not as drift, so a repo can adopt the way of working piece by piece without the doctor failing.
- 3cc7e5c: `test-cases:generate --testers <file>` now accepts an absolute path (it was joined onto the working directory and failed with ENOENT); relative paths still resolve against the cwd.

## 1.0.0-next.3

### Patch Changes

- 3cc7e5c: `test-cases:generate --testers <file>` now accepts an absolute path (it was joined onto the working directory and failed with ENOENT); relative paths still resolve against the cwd.

## 1.0.0-next.2

### Patch Changes

- f877e9c: - **`hooks:install` is safe inside container builds** (#27): consumers' Dockerfiles run `pnpm install` with the root package.json present, so the root `prepare` script runs where there is no `.git` and `HUSKY=0` is set. The installer now logs and returns without failing in both cases instead of asserting husky's shim directory. It also stops using `husky init`, which rewrote the consumer's `prepare` script to plain `husky`; the shims are created with `pnpm exec husky` when missing.
  - **`ci:doctor` only diffs a devkit-scaffolded workflow** (#28): a hand-written `.github/workflows/ci.yml` (no scaffold marker) is reported as "ci part not adopted yet", not as drift, so a repo can adopt the way of working piece by piece without the doctor failing.

## 1.0.0-next.1

### Minor Changes

- 1941426: `ci:*` — the CI job's logic as CLI commands, so the project's workflow only sequences them and a devkit bump updates what CI does:
  - `ci:commit-standards`: every non-merge PR commit must match the derived commit standard (`commits:show`) and be Verified when `commits.requireSigned`; PRs by `commits.exemptAuthors` are exempt. Reads the PR from the Actions event (or `--repo/--pr`).
  - `ci:cache attach|detach`: Node port of the Nx task-cache dance (re-homes the machine-id-named index so restored entries are hit).
  - `ci:check`: `ci:doctor` → `format:check` for changed projects (content files included) → every `ci.checks[]` whose `paths` match a changed file.
  - `ci:affected [--targets] [--with-content] [--dry-run]`: port of the affected wrapper — graph targets via `nx show projects --affected`, own-files targets by ownership, docs and `ci.affected.contentOnly` dropped, `ci.affected.adopted` honoured.
  - `ci:doctor` also compares `.github/workflows/ci.yml` with the installed template and prints the diff.
  - `init` scaffolds the thin workflow for Nx workspaces from `ci.nodeVersion` (default `24`), `ci.baseBranch` (default `main`) and `commits.exemptAuthors`.

- a5d56cc: The Claude Code layer, delivered without copied content:
  - `claude/standards.md` ships the house rules (Docker via scripts; one ticket = one worktree = one stack; never commit/push without the user's explicit ask in the current request, commit-writer before staging, signed commits, no AI attribution; PR assignee; ticket ownership; acceptance cases instead of unit tests; lint/format/CI parity and Nx input contract; domain docs). The project's `CLAUDE.md` gets one `@import` line pointing at it.
  - `claude/agents/commit-writer.md` and `claude/skills/implement-ticket/SKILL.md` ship the bodies; the project holds stubs that read them at runtime. The commit-writer body takes the ticket token, types and scopes from `hassan-devkit commits:show` — no mirrored lists.
  - `hassan-devkit claude:install` (idempotent; run by `prepare` and by `init`) writes the import line under the H1 of the existing `CLAUDE.md`, the stubs (never overwritten once edited) and merges the PR-assignee `PreToolUse` deny hook into `.claude/settings.json`.
  - `init`'s `prepare` script becomes `hassan-devkit hooks:install && hassan-devkit claude:install` (husky repos) or `hassan-devkit claude:install` (others).

- a3b0871: Pre-commit chain without a hand-kept project list:
  - **`@coding-with-hassan/devkit/lint-staged`** (ESM): `export default lintStaged()` derives the lint-staged targets from the workspace — every project with an ESLint/Prettier config gets `pnpm -C <dir> exec …` entries (api: `**/*.ts`; spa/lib: `src/**/*.{ts,html}` and `src/**/*.{scss,css,json}`, so committed native folders are never touched). `{ extra }` merges entries for files outside any project. Replaces the one-api-one-spa factory of `@coding-with-hassan/lint-staged-config` for Nx workspaces (that package stays for flat repos).
  - **Hook body**: project seam → `i18n:check` → `ci:doctor` when `.github/workflows/ci.yml` is staged → `lint-staged`.
  - **`hooks:install`** now also (re)creates husky's per-checkout shim dir when `.husky/_` is missing and fails loudly when the shims are still absent — git silently skips every hook otherwise. Runs from `prepare`, so every worktree install is covered.
  - **`ci:doctor`** (first version): fails when the installed devkit does not satisfy the range declared in `package.json` (a stale `node_modules` silently loses features), when the config block is invalid, or when `.husky/_/pre-commit` is missing.
  - `init` scaffolds `lint-staged.config.mjs` for husky repos and notes a legacy `lint-staged.config.js` that must be removed (lint-staged reads one config file).

- 2eb8f7b: `test-cases:generate` — the bilingual acceptance-test workbooks as a CLI, ported from car-rental's `docs/testing/generate-test-cases.ts`:
  - `@coding-with-hassan/devkit/test-cases` exports `tc` (positional en/nl case), `tcase` and the types (`Area`, `TestCase`, `KnownIssue`, `Readme`, …) so a project's `tc-data-*.ts` files import their vocabulary from the package.
  - Suites are discovered as `<testCases.dir>/tc-data-<suite>.ts`; each exports `*_AREAS`, `*_KNOWN_ISSUES`, `*_README`. `--lang` restricts the languages (`testCases.languages`, default en + nl), `--testers file.json` adds personalised workbooks. Workbook UI strings ship for `en` and `nl`; `testCases.title` names the project in the Read Me.
  - The TypeScript data files are loaded with Node's built-in type stripping through a small loader hook (no `tsx`); type names must be imported with the `type` modifier. **`engines.node` is now `>=22.13`.**
  - `init` scaffolds a starter `tc-data-app.ts` when `testCases` is configured and the directory has no data yet.

### Patch Changes

- 1e4f82b: - **Inert worktree skeleton** (#22): the `worktree` block `init` merges into every package.json is empty until the project fills it in. In a repo with a compose file, that skeleton no longer counts as "worktree configured": `docker:up` does not run the implicit `worktree:env` (which would have managed `.env` next to the project's existing tooling and built a second image set), the `worktree:*` commands fail with an actionable message, and `.env.dist` is left alone. A repo without a compose file is active with `{}`, as before.
  - **`init --only <parts>`** (#23): `config`, `env`, `hooks`, `agents`, `ci`, `claude`, `test-cases` — scaffold one piece at a time when adopting the way of working in an existing repo. Default stays "everything".

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
