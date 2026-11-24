---
name: ticket-graph
description: "Ticket dependency chart plus the unlinked dependencies behind it: runs `hassan-devkit tickets:graph`, reads the descriptions of the tickets in scope for dependencies the tracker holds no link for, shows them as dashed edges with the sentence each one came from, and records as tracker links the ones the user confirms. Use when the user asks for the ticket graph, what blocks what, what to start next, or which dependencies are missing from the tracker."
---

# ticket-graph (body shipped by @coding-with-hassan/devkit)

`hassan-devkit tickets:graph` charts the dependencies the tracker holds as links. An
**unlinked dependency** is one a ticket description states and no link records: the chart
misses it, and can show a ticket as ready that is not. This skill finds them, shows them and
records the ones the user confirms. The tracker is written in step 4 only, and only for the
dependencies the user named there.

## 1. Chart

From the checkout root, run `hassan-devkit tickets:graph`, with `--epic <KEY>` when the user
named an epic. Stdout is the Mermaid chart; an arrow runs from a blocker to the ticket it
blocks. Show it in a `mermaid` code block.

No chart, no skill: when the command exits with a note (tracker `none`) or fails (the tracker
could not be read), report what it printed and stop.

## 2. Find the unlinked dependencies

The tickets in scope are the nodes of the chart. Read every one (description, status, links)
the way `docs/agents/issue-tracker.md` reads an issue of this tracker:

- **GitHub**: `gh issue list --state open --limit 1000 --json number,title,body,state,assignees`
  returns the open issues in one call; `gh issue view <n> --json …` with the same fields reads
  a closed one. An issue's links are the `Blocked by #<n>` lines of its body. Issues live on
  the base repository: when the checkout has an `upstream` remote, every `gh` call of this
  skill takes `--repo <owner/repo>` of that remote.
- **Jira**: one search for the chart's keys (`key in (…)`) with the fields `summary`,
  `description`, `status`, `issuetype` and `issuelinks`. An issue's links are its `Blocks`
  entries.

A description states a dependency when its ticket cannot start or finish before another
ticket is done ("depends on", "needs the endpoint from", "after … lands", a `Blocked by` in
the middle of a sentence), or when it says the same of another ticket about itself ("… waits
for this"). A mention ("see also", "related to", "same as"), the epic a ticket is part of and
anything that is not a ticket of this tracker are not dependencies.

Then settle each one, in this order:

- An epic or a sub-task at either end: drop it. The chart draws tickets; an epic is a
  subgraph there, never a node.
- The other ticket is not a node: read it the same way. It joins the chart in step 3.
- A done ticket at either end: drop it. Finished work holds nothing back.
- The blocked ticket already links the blocker: drop it. It is linked; the chart left the
  arrow out.
- The chart has a path of arrows from the blocker to the blocked ticket that passes no done
  ticket: drop it. The links that exist imply it.
- The chart has such a path the other way: keep it and mark it as contradicting the tracker.
  Recording it would close a cycle, so the user decides which side is right.

Done when every node has been read and each dependency left has its blocker, its blocked
ticket, the ticket whose description states it, and that sentence word for word. None left:
tell the user the chart of step 1 is complete, and stop.

## 3. Show them

Copy the chart of step 1 and add, above its `classDef` lines:

- one dashed edge per unlinked dependency, blocker first: `  ABC_7 -.-> ABC_12`. A node id is
  the ticket key with `_` for `-`, as on the chart's own lines.
- one node line per ticket that joined in step 2, after the pattern of the others:
  `  ABC_7["ABC-7<br/>Title in plain words"]:::todo`. The class is `inProgress` for a started
  ticket (GitHub: an open issue with an assignee), else `todo`. Write the title in letters,
  digits, spaces and `.,:-` only: Mermaid reads most other punctuation as markup.

Show the redrawn chart in a `mermaid` code block and say how to read it: solid is a link in
the tracker, dashed an unlinked dependency, and an amber node with a dashed arrow into it is
a ticket the tracker shows as ready that may not be. Under it the list, one line each:

```
- ABC-7 → ABC-12, from ABC-12: "Needs the export endpoint of ABC-7 before the page can load."
```

## 4. Record the ones the user confirms

Ask which ones to record: one question listing them all, in the question dialog when the
harness has one, any number selectable, "none" a valid answer. Wait for the answer; it is the
consent for exactly the links it names.

Record each confirmed dependency as the link `tickets:graph` reads:

- **GitHub**: a `Blocked by #<n>` line appended to the body of the blocked issue. The edit
  replaces the whole body, so read it in the same command; the `&&` keeps a failed read from
  writing anything. Several blockers of one issue: one line each, one edit. A body that ends
  in a `## Parent` section takes the line above that heading instead: under it, the number
  would be read as the issue's epic.

  ```sh
  body=$(gh issue view <blocked> --json body --jq .body) &&
    printf '%s\n\nBlocked by #<blocker>\n' "$body" | gh issue edit <blocked> --body-file -
  ```

- **Jira**: a `Blocks` link whose inward issue is the blocker, so that the blocked ticket reads
  "is blocked by <blocker>". The field names suggest the opposite; the body below is the
  right way round, for the Atlassian MCP's issue-link tool when connected and else for
  `POST /rest/api/3/issueLink` with the credentials `docs/agents/issue-tracker.md` names.

  ```json
  { "type": { "name": "Blocks" }, "inwardIssue": { "key": "<blocker>" }, "outwardIssue": { "key": "<blocked>" } }
  ```

Then re-run the command of step 1 and show the new chart. A recorded dependency is now a
solid arrow from its blocker to its blocked ticket, or a path of arrows that passes no done
ticket. One that runs the other way is a failed write. One that does not show at all: read
the blocked ticket back from the tracker, since the chart's scope leaves some links out
(`--epic` draws the epic's tickets and their direct blockers only). The link is there, or it
is a failed write too. Report a failed write with the ticket to fix by hand.

Report in one short message: the links recorded, the dependencies left unlinked, and the
tickets that were ready in step 1 and no longer are.
