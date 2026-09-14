---
'@coding-with-hassan/devkit': minor
---

The mattpocock skills reach every project as a versioned dependency, not a plugin:

- `init` adds `mattpocock-skills` (`github:mattpocock/skills#v1.2.3`, a GitHub tarball pinned to an upstream release tag) to the root `devDependencies`. pnpm resolves it to an integrity-locked tarball, so no git binary is needed and `--frozen-lockfile` builds keep working.
- `claude:install` (run by `prepare`) writes one stub per skill: the house `implement-ticket` shipped by the devkit and every skill listed by the installed package's plugin manifest except `implement` and `setup-matt-pocock-skills`, which the house skill and `init` replace. The stub carries the skill's frontmatter verbatim (name, description, `disable-model-invocation`, `argument-hint`), so user-invocable-only skills stay user-only, and points at the body under `node_modules`. Committed stubs were the only way to reach teammates and skill pickers that scan just `.claude/skills` (T3 Code); generated stubs do the same on every install.
- The stubs are derived, so they are regenerated on every install and gitignored through a managed `# >>> hassan-devkit … # <<< hassan-devkit` block in `.gitignore`. A dependency bump leaves nothing to commit. `claude:install` prints the one-off `git rm --cached` for stubs a project still tracks.
- Updates flow through Renovate (`github-tags` datasource on the pinned tag); the shared preset automerges them. No devkit release is involved in a skills update.

Upgrading: run `hassan-devkit init --only config`, `pnpm install`, then the `git rm --cached` the install prints for `.claude/skills/implement-ticket/SKILL.md`. If the plugin is still enabled in `~/.claude`, a bare `/grilling` runs the project stub and `/mattpocock-skills:grilling` the plugin — same body, disable the plugin to see each skill once.
