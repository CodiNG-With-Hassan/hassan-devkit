---
status: accepted
date: 2026-09-13
---

# Standards ship as one versioned npm package, including the Claude Code layer

The way of working that car-rental grew by hand (worktrees with isolated stacks, pre-commit
chain, CI with commit standards, and the Claude Code instructions, agents and hooks) has to
reach every new project and stay current there. We decided that `@coding-with-hassan/devkit`
is the single delivery vehicle for all of it: scripts and CI logic run from the installed
version, and the Claude layer is reached through a CLAUDE.md `@import` of a file inside
`node_modules` plus committed stubs whose bodies say "read the package file and follow it".
A Renovate bump is therefore the whole update; nothing generated has to be re-committed.

## Considered Options

- **Template repo only** — rejected: copies drift the day after they are made; no bump path.
- **npm package + Claude Code plugin** — rejected: plugins cannot deliver CLAUDE.md text, so
  the `@import` trick is needed anyway, and a plugin adds a second version stream that must be
  kept in step with npm.
- **Generated copies of agents/skills/rules into `.claude/`** — rejected as the primary
  mechanism: a Renovate PR only changes `package.json`, so the copies would be stale until
  someone regenerates and commits; runtime stubs remove that step. Copies remain acceptable for
  files that must be greppable in the repo.
- **Reusable GitHub workflow tagged in this repo** — rejected for CI: it would version the CI
  logic by git tag next to the npm version. Instead the project owns a thin scaffolded
  workflow whose steps call `hassan-devkit ci:*`, and `ci:doctor` flags skeleton drift.

## Consequences

The package must work from `node_modules` at Claude launch, so the `prepare` script and a
fresh install are prerequisites for the standards to load at all. Project-specific rules stay
in the project's own CLAUDE.md below the import line; the package text must stay free of any
one project's names. New features assume an Nx `apps/*` + `libs/*` pnpm monorepo; the legacy
`docker:*`, `db:*`, `hooks:*` commands stay layout-agnostic for the flat consumers that exist.
