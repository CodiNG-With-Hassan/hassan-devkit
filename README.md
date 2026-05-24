# hassan-devkit

A small ecosystem of shared developer-experience packages that I use across the websites I build for clients. Each client repo consumes these as ordinary npm dependencies, so when I change a rule here, every project picks it up on the next bump (Renovate auto-PRs them).

## Packages

| Package | What it is |
|---|---|
| [`@coding-with-hassan/eslint-config-api`](./packages/eslint-config-api) | NestJS / Node ESLint flat config |
| [`@coding-with-hassan/eslint-config-spa`](./packages/eslint-config-spa) | Angular ESLint flat config |
| [`@coding-with-hassan/prettier-config-api`](./packages/prettier-config-api) | Prettier preset for backend TS |
| [`@coding-with-hassan/prettier-config-spa`](./packages/prettier-config-spa) | Prettier preset for Angular |
| [`@coding-with-hassan/lint-staged-config`](./packages/lint-staged-config) | Project-aware lint-staged config for split monorepos |
| [`@coding-with-hassan/renovate-config`](./packages/renovate-config) | Renovate preset that groups `@coding-with-hassan/*` bumps |
| [`@coding-with-hassan/devkit`](./packages/devkit) | CLI for docker compose, db helpers, and husky hooks |

## Companion template

The [`hassan-devkit-template`](https://github.com/CodiNG-With-Hassan/hassan-devkit-template) repo is a GitHub *template* that already consumes all of the above. Click **Use this template** to scaffold a new client project.

## Versioning / publishing

This repo uses [changesets](https://github.com/changesets/changesets). When you make a user-visible change, run `pnpm changeset`, pick the affected packages and bump type, and commit the generated file with your code. Merging to `main` opens a "Version Packages" PR; merging that PR publishes to npm.

The publish flow lives in `.github/workflows/release.yml` and needs one repo secret: `NPM_TOKEN` (an npm access token with publish rights for the `@hassan` scope). Provenance is enabled via `id-token: write` and the workflow's `--provenance` (set in `.npmrc`).

## License

MIT
