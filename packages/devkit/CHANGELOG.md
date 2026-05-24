# @coding-with-hassan/devkit

## 0.2.0

### Minor Changes

- 0cb02c2: Switch `db:*` and `docker:restart` commands to address services through `docker compose exec <service>` instead of hardcoded container names. This means client repos no longer need to set `container_name:` in their compose file or repeat the brand prefix on every service — the compose project name does the disambiguation.

  **Breaking change** to the `hassan-devkit` config block in `package.json`:

  ```diff
   "hassan-devkit": {
     "db": {
  -    "container": "de-autozaak-db",
  +    "service": "db",
       "user": "postgres",
       "name": "de_autozaak"
     }
   }
  ```

  `docker:restart` now takes a compose service name (e.g. `api`) instead of a hardcoded container name (e.g. `de-autozaak-api`).

## 0.1.0

### Minor Changes

- 3b38c23: Initial public release.
  - Shared ESLint flat configs for NestJS (`@coding-with-hassan/eslint-config-api`) and Angular (`@coding-with-hassan/eslint-config-spa`), exposed as factory functions so consumers pass `tsconfigRootDir` / selector `prefix`.
  - Prettier presets for both stacks.
  - Project-aware `lint-staged` factory for monorepos with an API and SPA folder side by side.
  - Renovate preset that groups `@coding-with-hassan/*`, Angular, NestJS, PrimeNG, NgRx, and TypeORM bumps into meaningful PRs.
  - `@coding-with-hassan/devkit` CLI with `docker:*`, `db:*`, and `hooks:*` commands, plus a ships-from-package husky pre-commit hook so the hook content itself updates via dependency bumps.
