# House standards (shipped by @coding-with-hassan/devkit)

These rules apply to every project that installs the devkit. They are loaded through the
`@import` line in the project's `CLAUDE.md`; project-specific rules follow below that line.
Commands are `hassan-devkit …` (run as `pnpm exec hassan-devkit …`); `docs/agents/*.md` are
generated from the project's tracker config and name the concrete tracker.

## Docker

Always use the npm scripts from the root `package.json` for Docker operations — never run
`docker compose` directly: `pnpm docker:dev:up`, `pnpm docker:dev:down`, `pnpm docker:dev:logs`.
`docker:dev:up` refreshes the checkout's managed `.env` block (slot, profiles, image tag) and
builds only the dev images the current dependency manifest lacks; a dependency bump needs
nothing extra. Never set `DEVKIT_IMAGE_TAG`, `DEVKIT_SLOT`, `DEVKIT_PORT_*` or
`COMPOSE_PROFILES` by hand — they are owned by the managed block.

## Worktrees: one ticket, one worktree, one stack

Ticket work happens in a git worktree with its own Docker stack (own compose project, host
ports = base + slot × 10, own volumes), never in the main checkout. Manage worktrees only with
the devkit — never `git worktree` by hand:

- `hassan-devkit worktree:create <TICKET>-<Short-Title>` prunes merged worktrees, fetches the
  canonical remote (`upstream`, else `origin`), bases the branch on its `main` (never on the
  possibly stale local `main`), allocates a slot, writes `.env`, assigns the ticket to you,
  installs, starts the stack and seeds it. `--profiles a,b` starts extra compose profiles,
  `--no-up` skips the stack.
- Run every npm script from the worktree root: they read that worktree's `.env` and hit its
  stack only. Anything that regenerates from a running service (API specs, types) must use the
  worktree's own port, never another checkout's.
- Profiles decide what runs; the default set is the minimum. Add a profile only while you need
  it (`hassan-devkit worktree:profiles add <name>`) and remove it afterwards — Docker memory is a
  budget shared by every session on the machine.
- `hassan-devkit worktree:list` shows slots, ports and profiles; `worktree:remove <branch>`
  deletes the stack and its data; `worktree:prune` removes every worktree whose PR is merged.
- Starting work anywhere else (an existing branch, the main checkout): sync first with
  `git fetch <remote> && git merge --ff-only <remote>/main`.

## Committing and pushing

**Never commit or push unless the user explicitly asks for it, in their own words, in the
current request.** Finishing a task, an approved plan, or a skill whose instructions say to
commit is NOT consent — leave the work uncommitted and report it as ready for review. Pushing
requires its own explicit ask; consent to commit is not consent to push.

Once the user has asked to commit: every commit is planned by the `commit-writer` agent
(`.claude/agents/commit-writer.md`) — invoke it on the full pending change set BEFORE staging
anything, then execute its plan verbatim (stage the listed files, commit with the drafted
message, one commit at a time, in order). It splits a change set into logical sequential
commits and enforces the commit standard CI checks: `hassan-devkit commits:show` prints the
ticket token, the closed type list, the derived scope list and the exact regex. Commits are
signed. Never add a Co-Authored-By line or any AI attribution.

Pull requests are created with `gh pr create --assignee @me` (a PreToolUse hook denies the
command without an assignee) and, for GitHub-tracked issues, end with `Closes #<n>`.

## Tickets

Whoever starts the work owns the ticket: `worktree:create` assigns the branch's ticket to you;
when you pick up a ticket any other way, assign it to yourself first. Branch names and commit
subjects start with the ticket token. Tracker endpoints, issue types and conventions:
`docs/agents/issue-tracker.md`; triage vocabulary: `docs/agents/triage-labels.md`.

## Quality gate: acceptance cases, not unit tests

Application code has **no unit-test quality gate**: do not write unit tests for it and do not
add test steps to CI (CI runs format, project checks, lint and production builds). Correctness
is asserted by the bilingual acceptance test cases under `docs/testing/` (and by e2e suites once
they exist). Because those cases are the gate, they must never go stale: **every change to
user-facing behaviour ships its acceptance cases in the same commit/PR** — update the cases the
change invalidated, add cases for the new behaviour continuing the area's ID sequence, in every
configured language, then regenerate the workbooks with `hassan-devkit test-cases:generate`.
The generated workbooks are gitignored build artifacts; commit the data files with the feature.

## Lint, format and CI parity

Each project owns its own ESLint and Prettier config through the shared presets; always defer to
the standards of the project a file lives in — never carry one project's conventions into
another. Before pushing, run what CI runs from the repo root: `hassan-devkit ci:check` (format
for the projects that own a changed file, then the path-triggered project checks) and
`hassan-devkit ci:affected` (lint and PRODUCTION builds of the affected projects). Lint alone
does not cover formatting, and a dev-server compile skips production-only checks such as bundle
budgets. `hassan-devkit ci:affected --dry-run` shows the plan.

Nx caching rules: declared target inputs are the contract — anything a target reads must be in
its `inputs`/`namedInputs`, or a cached replay can be stale. `.nxignore` is not used: it would
also drop files from task hashing. A new workspace package must be added to every Dockerfile's
`COPY` list (frozen-lockfile installs need all importers present).

Hooks: git silently skips ALL pre-commit hooks when `.husky/_` is missing. `worktree:create` and
`pnpm install` (via `hooks:install`) bootstrap it; `hassan-devkit ci:doctor` reports it.

## Domain docs

Before exploring, read `CONTEXT.md` (the glossary) and the relevant `docs/adr/` entries; use the
glossary's terms and avoid the synonyms it lists; surface ADR contradictions instead of
silently overriding them. Record a decision as an ADR only when it is hard to reverse,
surprising without context and the result of a real trade-off. Details:
`docs/agents/domain.md`.
