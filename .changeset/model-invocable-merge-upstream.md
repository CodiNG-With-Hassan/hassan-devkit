---
'@coding-with-hassan/devkit': minor
---

The `merge-upstream` house skill is now model-invocable: its frontmatter no longer carries `disable-model-invocation`, so the generated `.claude/skills/merge-upstream/SKILL.md` stub drops the flag on the next `pnpm install`. Claude used to stop and ask the user to type `/merge-upstream` even after being asked to "fix the PR's conflicts". Consent stays explicit. The skill runs only when the user's current request asks to bring `main` in, update the branch or fix its PR's conflicts, and that ask is the consent for exactly one commit, the merge commit. A branch that is merely behind is never a reason to run it unasked. Pushing still needs its own ask: when the same request asked for it ("fix the conflicts and push"), Claude pushes only after `ci:check` and `ci:affected` pass. `standards.md` and the README say the same.
