# @coding-with-hassan/devkit

CLI that wraps the developer workflow shared across Hassan's client projects: docker compose orchestration, postgres helpers, and the husky pre-commit hook.

## Install

```sh
pnpm add -D @coding-with-hassan/devkit
```

## Configure

Add a `hassan-devkit` block to your client repo's root `package.json` so the db commands know which compose service to address:

```json
{
  "hassan-devkit": {
    "db": {
      "service": "db",
      "user": "postgres",
      "name": "de_autozaak"
    }
  }
}
```

`service` is the docker-compose service name, **not** a hardcoded container name. The CLI runs `docker compose exec <service>`, so the project name in your compose file handles disambiguation when multiple client stacks share a host.

The docker commands assume `docker/docker-compose.dev.yml` and a `.env` file at the repo root (the convention the template repo ships with).

## Wire it into your scripts

```json
{
  "scripts": {
    "docker:dev:up": "hassan-devkit docker:up",
    "docker:dev:down": "hassan-devkit docker:down",
    "docker:dev:logs": "hassan-devkit docker:logs",
    "db:list-tables": "hassan-devkit db:list-tables",
    "db:psql": "hassan-devkit db:psql",
    "prepare": "hassan-devkit hooks:install"
  }
}
```

## Commands

### Docker

- `hassan-devkit docker:up` — `docker compose up -d --build`
- `hassan-devkit docker:down` — `docker compose down`
- `hassan-devkit docker:logs` — tail logs
- `hassan-devkit docker:restart <service>` — `docker compose restart <service>`

### Database

- `hassan-devkit db:list-tables` — `\dt`
- `hassan-devkit db:describe <table>` — `\d <table>`
- `hassan-devkit db:count <table>` — `SELECT COUNT(*) FROM <table>`
- `hassan-devkit db:truncate <table>` — `TRUNCATE TABLE <table> CASCADE`
- `hassan-devkit db:psql` — interactive psql shell

### i18n

- `hassan-devkit i18n:check` — validates translation JSON: flags keys missing from any language file and enforces UPPERCASE_SNAKE_CASE key naming. Add `--detailed` (per-module key counts) or `--detailed --show-keys` to inspect. No-ops when the project has no i18n directory, and runs automatically in the shared pre-commit hook.

  Configure via the `hassan-devkit.i18n` block in package.json (both fields optional):

  ```json
  {
    "hassan-devkit": {
      "i18n": { "dir": "public/assets/i18n", "languages": ["en", "nl"] }
    }
  }
  ```

  `dir` is resolved from the repo root — in a monorepo point it at the app (e.g. `spa/public/assets/i18n`). Defaults: `public/assets/i18n` and `["en", "nl"]`.

### Husky hooks

- `hassan-devkit hooks:install` — installs husky if needed, then writes the shared `pre-commit` hook content into `.husky/pre-commit`. Re-run after bumping `@coding-with-hassan/devkit` to pick up changes to the hook.
- `hassan-devkit pre-commit` — runs the hook body directly. Used internally; the installed `.husky/pre-commit` file invokes this.
- `hassan-devkit hooks:print` — print the hook content to stdout (for inspection / diffing).

### Per-project extras

If a project needs to run something extra before the standard `i18n:check` + lint-staged steps, drop a `scripts/pre-commit-extra.sh` in the repo root. It runs first, must `exit 0` to continue. (Translation consistency is now built in via `i18n:check` — see above — so it no longer belongs here.)
