---
'@coding-with-hassan/devkit': minor
---

The shared pre-commit hook aborts the commit when lint-staged rewrote staged files: the staged tree (`git write-tree`) is compared before and after `lint-staged`, the fixers are re-run until the tree is stable (they cascade — Prettier reformats what `eslint --fix` produced only on the next run), and a changed tree exits 1 listing the rewritten files, which stay applied and staged. Review, rebuild, then run the same `git commit` again — the second attempt passes; clean commits pass in one go with no extra output. Why: an `eslint --fix` such as `type` → `interface` used to slip into the commit and fail CI's production build while the local build had been green. Consumers pick it up on `pnpm install` (`hooks:install` rewrites `.husky/pre-commit`).
