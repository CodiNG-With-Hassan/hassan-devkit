# hassan-devkit

<!-- devkit standards: house rules shipped by @coding-with-hassan/devkit; project rules follow -->
@../node_modules/@coding-with-hassan/devkit/claude/standards.md

## This repo

pnpm workspace of the `@coding-with-hassan/*` packages (`packages/*`), released with changesets
(`.changeset/`, pre mode `next` while the 1.0 line of `devkit` is built). The repo consumes its
own `devkit` as a `workspace:*` devDependency, so the standards above, the `worktree:*` commands
(GitHub tracker, no Docker stack) and `claude:install` run here exactly as in a client project.

- Design of the 1.0 line: `docs/design/way-of-working.md`, decisions in `docs/adr/`.
- `devkit` is plain Node ESM with `node --test` on pure logic only (`pnpm test`); no build step.
- Every user-visible change ships a `.changeset/*.md`; the shipped Claude content under
  `packages/devkit/claude/` must never name a client project (a test enforces it).
- Issues are GitHub issues of this repo (`GH-<n>` branches and commit subjects); see
  `docs/agents/issue-tracker.md`.
