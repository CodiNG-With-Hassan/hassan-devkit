---
'@coding-with-hassan/devkit': minor
---

The Claude Code layer, delivered without copied content:

- `claude/standards.md` ships the house rules (Docker via scripts; one ticket = one worktree = one stack; never commit/push without the user's explicit ask in the current request, commit-writer before staging, signed commits, no AI attribution; PR assignee; ticket ownership; acceptance cases instead of unit tests; lint/format/CI parity and Nx input contract; domain docs). The project's `CLAUDE.md` gets one `@import` line pointing at it.
- `claude/agents/commit-writer.md` and `claude/skills/implement-ticket/SKILL.md` ship the bodies; the project holds stubs that read them at runtime. The commit-writer body takes the ticket token, types and scopes from `hassan-devkit commits:show` — no mirrored lists.
- `hassan-devkit claude:install` (idempotent; run by `prepare` and by `init`) writes the import line under the H1 of the existing `CLAUDE.md`, the stubs (never overwritten once edited) and merges the PR-assignee `PreToolUse` deny hook into `.claude/settings.json`.
- `init`'s `prepare` script becomes `hassan-devkit hooks:install && hassan-devkit claude:install` (husky repos) or `hassan-devkit claude:install` (others).
