---
'@coding-with-hassan/devkit': minor
---

Tracker adapters for `worktree:create`, selected by `hassan-devkit.tracker.kind`:

- `jira` (`project`, optional `baseUrl`): assigns the branch's ticket to the current user and moves a `To Do` ticket to `In Progress`; credentials from `JIRA_EMAIL`/`JIRA_API_TOKEN`/`JIRA_URL` in the environment or `~/.config/jira/env`. Best effort — every failure is a `note:`.
- `github` (`prefix`, default `GH`): branch `GH-<n>-Title` → `gh issue edit <n> --add-assignee @me` on the base repo (`upstream`, else `origin`). No status change: the open PR is the progress signal. Commit subjects use `GH-<n>`; PR bodies end with `Closes #<n>`.
- `none`: no-op.

`hassan-devkit init` now also renders `docs/agents/issue-tracker.md`, `triage-labels.md` and `domain.md` from the tracker config (managed files: regenerated on every init) so the engineering skills find the right endpoints and label vocabulary.
