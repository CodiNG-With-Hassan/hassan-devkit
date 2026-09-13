---
'@coding-with-hassan/devkit': major
---

Foundation of the 1.0 line — the way of working as a versioned package (design: `docs/design/way-of-working.md`, ADR 0001).

- **Config contract**: the `hassan-devkit` block of the root `package.json` gains `worktree`, `tracker` (`jira` | `github` | `none`), `commits`, `ci` and `testCases` sections with defaults and validation (`hassan-devkit config:check`). Unknown keys are rejected so a typo cannot silently disable a feature.
- **Derivation instead of declaration**: workspace projects (name = directory basename, kind `api` | `spa` | `lib`) come from `pnpm-workspace.yaml`; commit scopes = project names + `commits.extraScopes`; compose profile → service and buildable-image maps come from `docker compose config`; the dev image tag is a content hash of the lockfile, workspace file, every `package.json` and every `docker/Dockerfile*.dev`; the canonical remote is `upstream` when present.
- **`hassan-devkit init`**: idempotent scaffold — config skeleton + default scripts merged into `package.json` (adds only missing keys), the slot-0 managed block in `.env.dist` (fixed `DEVKIT_*` keys), and the `scripts/pre-commit-extra.sh` seam. `--dry-run` previews, `--force` overwrites edited files after printing a diff.
- **`config:show`** / **`commits:show`** (`--json`): declared + derived values in one place; the commit-subject regex `^<TICKET> (<types>)\((<scopes>)\): [a-z]` that CI and the commit-writer agent share.
- Tests: `node --test` on the pure logic (config, derivation, env block, scaffold, init).

The `major` bump starts the `1.0.0-next.*` prereleases (changesets pre mode); no existing command changes behaviour in this release.
