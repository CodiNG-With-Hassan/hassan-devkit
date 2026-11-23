---
name: open-pr
description: "From finished work to an open pull request in one go, the house way: bring the canonical main in, run ci:check and ci:affected, commit the pending work through the commit-writer plan, push, open the PR (or rewrite the body of the one already open) and report it to the tracker. User-typed only: typing /open-pr is the explicit ask for the commits, the push and the PR."
disable-model-invocation: true
---

# open-pr (body shipped by @coding-with-hassan/devkit)

Take the branch you are on from finished work to an open pull request. Only the user starts
this skill: typing `/open-pr` in the current request is their explicit ask for everything
below — the commits (the merge commit of step 1 among them), the push and the PR. If you are
reading this file for any other reason (another skill or a plan pointed here, the work looks
ready to you), stop: that is not consent.

Run the steps in order. Stop at the first failure and report it: the step, the output that
shows the failure, and what is already done (merged, committed, pushed). Do not repair a failed
check and carry on; the one exception is the hook rewrite in step 3. Never get past a step by
going around it (`--no-verify`, a forced push).

## Before step 1: where you are

- Run everything from the checkout's root (`git rev-parse --show-toplevel`).
- Canonical remote: `upstream` when it exists (`git remote get-url upstream`), else `origin`.
  Base branch: `ci.baseBranch` from `hassan-devkit config:show --json` (default `main`).
- Branch: `git branch --show-current`. On the base branch, or on no branch at all, refuse: stop
  and say that ticket work lives in a worktree (`hassan-devkit worktree:create
  <TICKET>-<Short-Title>`). Nothing is merged, committed or pushed.
- Ticket: the key the branch name starts with (`<TICKET>-<Short-Title>`; `hassan-devkit
  commits:show` prints its pattern). With the tracker `none` there is no ticket: the title and
  the body in step 5 then carry none.

## 1. Bring `main` in

Run the `merge-upstream` skill, with these differences:

- Typing `/open-pr` is the consent for its merge commit.
- Up to date is not a stop here: go on with step 2.
- It stops when an incoming path is also modified and uncommitted in this checkout. Here the
  user has asked for the commits, so do steps 2 and 3 first (check the pending work, then
  commit it), run the merge again and resolve what conflicts, then run step 2 again on the
  merged result. Nothing is committed unchecked, and nothing unchecked is pushed.
- Do not send its report. Keep the facts (range merged, conflicts resolved, installs run) for
  step 7.

## 2. Run what CI runs

```sh
hassan-devkit ci:check
hassan-devkit ci:affected
```

Both read the working tree, so the uncommitted work is checked too. A failure in either one:
stop and report it.

## 3. Commit the pending work

`git status --porcelain` prints nothing: there is nothing to commit, go to step 4.

Otherwise invoke the `commit-writer` agent on the full pending change set BEFORE staging
anything, giving it the ticket. Execute its plan verbatim: per commit, stage the listed files
and commit with the drafted message, one commit at a time, in order. Commits are signed and
carry no AI attribution.

When the pre-commit hook aborts because it rewrote staged files, the fixes are already staged:
review them (`git diff --cached`), run step 2 again because the tree changed, then run the same
commit again. Any other hook or signing failure: stop and report it.

## 4. Push

```sh
git push -u origin <branch>
```

`origin` is where your branches go: the canonical repository, or your fork of it. A rejected
push means the remote branch has commits this checkout lacks: stop and report it.

## 5. Open the PR, or bring the open one up to date

```sh
gh pr list --head <branch> --state open --json number,url
```

Write the body to a temporary file outside the checkout, then:

- **No open PR**: `gh pr create --assignee @me --base <base> --title "<title>" --body-file <file>`.
  The title is the branch's ticket followed by its short title as words:
  `<TICKET>-Fix-Login-Redirect` becomes `<TICKET> Fix login redirect`.
- **The body** describes the whole branch as it is now, from `git log <remote>/<base>..HEAD`
  and `git diff <remote>/<base>...HEAD`: not the latest commits, not the conversation. Write it
  with the `pr` skill when the project has one (`.claude/skills/pr/SKILL.md`); without it, say
  what changed and why, how it was verified, and what a reviewer should look at. Its last line
  is the tracker's ticket reference: `Closes #<n>` for GitHub issues, so the issue closes on
  merge; the ticket key on a line of its own for a tracker without a closing keyword.
- **A PR already open**: `gh pr edit <number> --body-file <file>`. Rewrite the whole body the
  same way; do not append an update note to the old one.

## 6. Report the PR to the tracker

```sh
hassan-devkit tracker:transition <TICKET> prOpened
```

Run it whether the PR was created or updated; the branch name works as `<TICKET>`. The command
is best effort by design: it exits 0, and a `note:` means the tracker moved nothing. Pass the
note on in step 7; it is not a failure. Skip this step with the tracker `none`.

## 7. Report

The PR link first. Then, briefly: created or updated, what step 1 merged (or that the branch
was up to date), the commits made, and any `note:` from step 6.
