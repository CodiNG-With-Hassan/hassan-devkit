---
'@coding-with-hassan/devkit': minor
---

New house skill `project-setup`: a repository freshly created from the template, taken to its setup PR. Starting a project repeated the same setup after "Use this template": rename everything, wire the tracker, write the glossary, apply the design system, configure the repository and open the setup PR.

- **User-typed only.** The skill has `disable-model-invocation: true`: it writes outside the working tree (a ticket in the tracker, a worktree, the repository's settings), so Claude can never start it. Typing `/project-setup` is the ask for those. It is not an ask for commits or a push: the skill ends by telling you to type `/open-pr`.
- **Re-runnable.** Every step first checks whether it is already done, so after an interruption you type it again and it continues where it stopped. The last step, the checks, runs on every run. The setup ticket's description holds the answers and the concept brief, so nothing is asked twice.
- **Steps**, stopping at the first failure and reporting it:
  1. ask for the project name, the tracker (a Jira project, or GitHub issues with a ticket key), the languages and a concept brief (a file or pasted text); derive the slug, the database name and a set of host ports that collide with none of the projects checked out next to it, and show them for correction;
  2. create the setup ticket in the tracker and its worktree, `hassan-devkit worktree:create <TICKET>-Project-Setup --no-up`;
  3. rename the template's placeholders in that worktree: the `hassan-devkit` config block, the project name, the ticket key and the `tpl-i18n` package, the host ports (host side only) and the languages. Generated files are regenerated, never edited: the lockfile, the managed block of `.env.dist` and `docs/agents/*.md` (`hassan-devkit init --only env,agents`), the API spec and its packages from the worktree's own stack, the acceptance workbooks;
  4. run the `grill-with-docs` skill on the concept brief (never the plain `grilling` skill), which writes `CONTEXT.md` and an ADR for each decision the brief forces;
  5. run the `sync-theme` skill, skipped and reported when the project has no design system yet;
  6. set the repository settings: merge commits as the only merge method and delete branch on merge. Branch rules are not set: they are unavailable on private repositories on the free plan. For Renovate it removes the template's own automerge rule from `renovate.json` and gives you the link to add the repository to the Renovate app;
  7. run `hassan-devkit ci:check` and `hassan-devkit ci:affected`, report, and hand over to `/open-pr` for the setup PR.
- **After the merge**, the report tells you to run `hassan-devkit worktree:prune` in the main checkout before bringing `main` in: the setup worktree was created under the template's `worktree.baseDir`, and the devkit stops looking there once the project's own config is in. It also names what the merge does not reach: the main checkout's own `.env`, and with a Jira tracker the ticket's `merged` transition.
- **It stops at the setup PR.** Specs and tickets are the next stage, with the `to-spec` and `to-tickets` skills. Deployment configuration is out of scope.
- `claude:install` installs it like the other house skills: a generated, gitignored `.claude/skills/project-setup/SKILL.md` stub on the next `pnpm install`.
