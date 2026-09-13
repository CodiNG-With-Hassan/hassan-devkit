# implement-ticket (body shipped by @coding-with-hassan/devkit)

Implement the work described by the user in the spec or tickets.

- Work in the ticket's worktree (`hassan-devkit worktree:create <TICKET>-<Short-Title>` when
  none exists); assign the ticket to yourself if the worktree command did not.
- Read `CONTEXT.md` and the relevant `docs/adr/` first and use the glossary's terms.
- Use /tdd where the project has a test suite for the layer you touch, at pre-agreed seams;
  application code in these projects has no unit-test gate — its gate is the acceptance cases.
- Run typechecking regularly and the project checks once at the end: `hassan-devkit ci:check`
  and `hassan-devkit ci:affected` from the repo root reproduce CI.
- Update the acceptance test cases for every user-facing change and regenerate the workbooks
  (`hassan-devkit test-cases:generate`).
- Once done, use /code-review to review the work.
- Do NOT commit or push: leave the work uncommitted and report it as ready for review. The
  user's explicit ask, in the current request, is the only thing that authorises a commit;
  when it comes, plan the commits with the `commit-writer` agent first.
