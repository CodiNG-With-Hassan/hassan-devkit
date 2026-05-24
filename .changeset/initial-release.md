---
'@coding-with-hassan/eslint-config-api': minor
'@coding-with-hassan/eslint-config-spa': minor
'@coding-with-hassan/prettier-config-api': minor
'@coding-with-hassan/prettier-config-spa': minor
'@coding-with-hassan/lint-staged-config': minor
'@coding-with-hassan/renovate-config': minor
'@coding-with-hassan/devkit': minor
---

Initial public release.

- Shared ESLint flat configs for NestJS (`@coding-with-hassan/eslint-config-api`) and Angular (`@coding-with-hassan/eslint-config-spa`), exposed as factory functions so consumers pass `tsconfigRootDir` / selector `prefix`.
- Prettier presets for both stacks.
- Project-aware `lint-staged` factory for monorepos with an API and SPA folder side by side.
- Renovate preset that groups `@coding-with-hassan/*`, Angular, NestJS, PrimeNG, NgRx, and TypeORM bumps into meaningful PRs.
- `@coding-with-hassan/devkit` CLI with `docker:*`, `db:*`, and `hooks:*` commands, plus a ships-from-package husky pre-commit hook so the hook content itself updates via dependency bumps.
