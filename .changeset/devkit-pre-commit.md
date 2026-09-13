---
'@coding-with-hassan/devkit': minor
---

Pre-commit chain without a hand-kept project list:

- **`@coding-with-hassan/devkit/lint-staged`** (ESM): `export default lintStaged()` derives the lint-staged targets from the workspace — every project with an ESLint/Prettier config gets `pnpm -C <dir> exec …` entries (api: `**/*.ts`; spa/lib: `src/**/*.{ts,html}` and `src/**/*.{scss,css,json}`, so committed native folders are never touched). `{ extra }` merges entries for files outside any project. Replaces the one-api-one-spa factory of `@coding-with-hassan/lint-staged-config` for Nx workspaces (that package stays for flat repos).
- **Hook body**: project seam → `i18n:check` → `ci:doctor` when `.github/workflows/ci.yml` is staged → `lint-staged`.
- **`hooks:install`** now also (re)creates husky's per-checkout shim dir when `.husky/_` is missing and fails loudly when the shims are still absent — git silently skips every hook otherwise. Runs from `prepare`, so every worktree install is covered.
- **`ci:doctor`** (first version): fails when the installed devkit does not satisfy the range declared in `package.json` (a stale `node_modules` silently loses features), when the config block is invalid, or when `.husky/_/pre-commit` is missing.
- `init` scaffolds `lint-staged.config.mjs` for husky repos and notes a legacy `lint-staged.config.js` that must be removed (lint-staged reads one config file).
