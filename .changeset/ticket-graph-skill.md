---
'@coding-with-hassan/devkit': minor
---

New house skill `ticket-graph`: the ticket dependency chart plus the dependencies the tracker has no link for. `tickets:graph` only sees links; a dependency that is only written in a ticket description was missing from the chart, and the ticket it blocks could show as ready.

- **What it does**: runs `hassan-devkit tickets:graph` (with `--epic` when you named one) and shows the chart, reads the descriptions of the tickets on it, and looks for dependencies that have no link. It shows the chart again with those as dashed edges and lists each with the sentence it came from. A dependency that is already linked, that the chart implies through a path of unfinished tickets, or that has a done ticket at either end is not proposed.
- **Recording**: it asks which ones to record and writes nothing to the tracker before that answer. A confirmed dependency becomes the link `tickets:graph` reads — a `Blocks` link in Jira (blocker as inward issue), a `Blocked by #<n>` line appended to the GitHub issue body — and the command runs again, so a write that did not land shows up at once.
- **Invocation**: model-invocable. Asking for the ticket graph, what blocks what or what to start next triggers it; `/ticket-graph` works too.
- **`claude:install` installs it everywhere**, like the other house skills: a generated, gitignored `.claude/skills/ticket-graph/SKILL.md` stub pointing at the shipped body. The next `pnpm install` writes it and adds the folder to the managed `.gitignore` block.
