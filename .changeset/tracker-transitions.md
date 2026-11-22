---
'@coding-with-hassan/devkit': minor
---

The Jira ticket now follows its PR. Until now the jira adapter assigned the ticket and moved it to `In Progress` on `worktree:create`, and every later move was made by hand.

- New optional config `tracker.transitions` for the jira tracker, with two keys: `prOpened` (default `In Review`) and `merged` (default `Acceptance`). Each names the status the ticket moves to for that event; `null` turns that transition off. Wrong shapes and unknown keys are reported by `config:check`.
- New command `hassan-devkit tracker:transition <TICKET> <prOpened|merged>`. The ticket is a key or a branch name starting with it. The transition is looked up by target status name among the ticket's available transitions, and a ticket already in or past the target status is left alone. Best effort like the `worktree:create` hook: missing credentials, an unreachable Jira or a workflow without that transition is a `note:` and exit 0. An unknown event name is a usage error and exits 1.
- `worktree:prune` (and so every `worktree:create`) runs the `merged` transition for the ticket of each worktree it removes because its PR is merged. A merged worktree it cannot remove (stray changes) keeps its ticket where it is; the note names the `tracker:transition` call to run after the manual removal.
- The `github` and `none` trackers move nothing: an open PR stays the progress signal there.
- The generated `docs/agents/issue-tracker.md` for Jira describes both moves and the configured statuses. Re-run `hassan-devkit init --only agents` to refresh it.
