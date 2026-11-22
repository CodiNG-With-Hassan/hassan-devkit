---
'@coding-with-hassan/devkit': minor
---

New house skill `open-pr`: one user-typed step from finished work to an open PR. Until now `merge-upstream` covered bringing `main` in, and the rest (run the checks, commit, push, open the PR) was typed by hand at the end of every ticket.

- **User-typed only.** The skill has `disable-model-invocation: true`, so Claude can never start it. Typing `/open-pr` is the explicit ask for the commits, the push and the PR in one go; `standards.md` now says so in the commit/push consent section.
- **Steps**, stopping at the first failure and reporting it:
  1. run the `merge-upstream` skill;
  2. run `hassan-devkit ci:check` and `hassan-devkit ci:affected` (both read the working tree, so pending work is checked before it is committed);
  3. when there is pending work, plan the commits with the `commit-writer` agent and execute the plan;
  4. push the branch to `origin`, never forced;
  5. no open PR for the branch: `gh pr create --assignee @me`, titled `<TICKET> <Short title>` from the branch name, with a body written with the `pr` skill and ending with the tracker's ticket reference (`Closes #<n>` for GitHub). A PR already open: its body is rewritten so it describes the branch as it is now;
  6. run `hassan-devkit tracker:transition <TICKET> prOpened`;
  7. report the PR link.
- **It refuses to run on the base branch**: nothing is merged, committed or pushed there.
- When uncommitted work collides with what the merge brings in, a bare `merge-upstream` stops. Here the ask for the commits is already given, so the pending work is checked and committed first, then merged, and the checks run again on the merged result. Nothing is committed unchecked.
- The `pr` skill ships with `mattpocock-skills` from v1.3. A project on an older tag gets a plain body: what changed and why, how it was verified, what a reviewer should look at.
- `merge-upstream` names `/open-pr` among the asks that are the consent for its merge commit.
- `claude:install` installs it like the other house skills: a generated, gitignored `.claude/skills/open-pr/SKILL.md` stub on the next `pnpm install`.
