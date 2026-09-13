---
'@coding-with-hassan/devkit': patch
---

- **Inert worktree skeleton** (#22): the `worktree` block `init` merges into every package.json is empty until the project fills it in. In a repo with a compose file, that skeleton no longer counts as "worktree configured": `docker:up` does not run the implicit `worktree:env` (which would have managed `.env` next to the project's existing tooling and built a second image set), the `worktree:*` commands fail with an actionable message, and `.env.dist` is left alone. A repo without a compose file is active with `{}`, as before.
- **`init --only <parts>`** (#23): `config`, `env`, `hooks`, `agents`, `ci`, `claude`, `test-cases` — scaffold one piece at a time when adopting the way of working in an existing repo. Default stays "everything".
