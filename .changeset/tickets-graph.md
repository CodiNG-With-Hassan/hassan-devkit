---
'@coding-with-hassan/devkit': minor
---

New command `hassan-devkit tickets:graph [--epic <KEY>] [--out <file>]`: the ticket dependency chart of the configured tracker as a Mermaid flowchart, so deciding what to start next no longer means asking for the chart by prompt in every project.

- **Scope**: every ticket that is not done, plus the tickets that block them directly (a done blocker one hop away stays visible). `--epic` narrows to one epic and keeps the blockers from other epics; a bare `241` or `#241` takes the tracker's ticket token.
- **Chart**: one subgraph per epic, an arrow from a blocker to the ticket it blocks, nodes coloured by status category (to do, in progress, done). Ready tickets — not started, every blocker done — are highlighted; a blocker that is not a node (an epic, an issue that could not be read) still counts until it is done. An edge that a longer path of unfinished tickets already implies is dropped (transitive reduction).
- **Trackers**: `jira` reads the project's issues that are not done with their `Blocks` links and parent, plus the issues blocking them (sub-tasks are left out). `github` reads the open issues plus the issues they reference; edges come from `Blocked by #<n>` body lines (also `Blocked by: #1, #2` and a `## Blocked by` section), the epic from the `Part of #<n>` line or `## Parent` section, and an open issue with an assignee counts as in progress. `none` exits with a note. A tracker that cannot be read fails the command.
- **Output**: the chart on stdout and a Markdown page (chart, colour key, the ready tickets by name) in `docs/tickets/dependencies.md`; `--out` writes elsewhere, and a `.mmd` / `.mermaid` file gets the chart alone. The managed `.gitignore` block now lists `docs/tickets/dependencies.md`, so the chart is never committed: the next `pnpm install` (`claude:install`) or `init` adds the line.
