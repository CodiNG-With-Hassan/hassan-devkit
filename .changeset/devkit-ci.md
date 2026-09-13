---
'@coding-with-hassan/devkit': minor
---

`ci:*` — the CI job's logic as CLI commands, so the project's workflow only sequences them and a devkit bump updates what CI does:

- `ci:commit-standards`: every non-merge PR commit must match the derived commit standard (`commits:show`) and be Verified when `commits.requireSigned`; PRs by `commits.exemptAuthors` are exempt. Reads the PR from the Actions event (or `--repo/--pr`).
- `ci:cache attach|detach`: Node port of the Nx task-cache dance (re-homes the machine-id-named index so restored entries are hit).
- `ci:check`: `ci:doctor` → `format:check` for changed projects (content files included) → every `ci.checks[]` whose `paths` match a changed file.
- `ci:affected [--targets] [--with-content] [--dry-run]`: port of the affected wrapper — graph targets via `nx show projects --affected`, own-files targets by ownership, docs and `ci.affected.contentOnly` dropped, `ci.affected.adopted` honoured.
- `ci:doctor` also compares `.github/workflows/ci.yml` with the installed template and prints the diff.
- `init` scaffolds the thin workflow for Nx workspaces from `ci.nodeVersion` (default `24`), `ci.baseBranch` (default `main`) and `commits.exemptAuthors`.
