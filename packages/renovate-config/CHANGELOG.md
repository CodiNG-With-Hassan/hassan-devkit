# @coding-with-hassan/renovate-config

## 0.1.1

### Patch Changes

- 21efa34: Replace deprecated `matchPackagePatterns` with `matchPackageNames` (and the `/regex/` form). Recent Renovate versions reject the deprecated key outright, which would stop PRs in any consumer repo. Behaviour of the grouped rules is unchanged.

## 0.1.0

### Minor Changes

- 3b38c23: Initial public release.
  - Shared ESLint flat configs for NestJS (`@coding-with-hassan/eslint-config-api`) and Angular (`@coding-with-hassan/eslint-config-spa`), exposed as factory functions so consumers pass `tsconfigRootDir` / selector `prefix`.
  - Prettier presets for both stacks.
  - Project-aware `lint-staged` factory for monorepos with an API and SPA folder side by side.
  - Renovate preset that groups `@coding-with-hassan/*`, Angular, NestJS, PrimeNG, NgRx, and TypeORM bumps into meaningful PRs.
  - `@coding-with-hassan/devkit` CLI with `docker:*`, `db:*`, and `hooks:*` commands, plus a ships-from-package husky pre-commit hook so the hook content itself updates via dependency bumps.
