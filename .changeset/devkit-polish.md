---
'@coding-with-hassan/devkit': patch
---

- `claude:install` skips (with a log line) inside container builds — no `.git` or `HUSKY=0` — instead of writing the Claude stubs into the image; `prepare` keeps working everywhere.
- Image pruning stays silent when a parallel `worktree:create` already removed the same unreferenced tag.
