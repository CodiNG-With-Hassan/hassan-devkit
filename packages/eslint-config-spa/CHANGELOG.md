# @coding-with-hassan/eslint-config-spa

## 0.2.0

### Minor Changes

- 1d1bc85: Accept a `tsconfigRootDir` option and pass it to typescript-eslint's parser options, mirroring `eslint-config-api`. Since typescript-eslint 8.5x the parser no longer reliably infers the root from the process cwd — in monorepos, editors run the ESLint server from the repo root and every file fails with "multiple candidate TSConfigRootDirs are present". Consumers should pass `tsconfigRootDir: __dirname`.

## 0.1.0

### Minor Changes

- 3b38c23: Initial public release.
  - Shared ESLint flat configs for NestJS (`@coding-with-hassan/eslint-config-api`) and Angular (`@coding-with-hassan/eslint-config-spa`), exposed as factory functions so consumers pass `tsconfigRootDir` / selector `prefix`.
  - Prettier presets for both stacks.
  - Project-aware `lint-staged` factory for monorepos with an API and SPA folder side by side.
  - Renovate preset that groups `@coding-with-hassan/*`, Angular, NestJS, PrimeNG, NgRx, and TypeORM bumps into meaningful PRs.
  - `@coding-with-hassan/devkit` CLI with `docker:*`, `db:*`, and `hooks:*` commands, plus a ships-from-package husky pre-commit hook so the hook content itself updates via dependency bumps.
