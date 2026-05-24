# @coding-with-hassan/lint-staged-config

Project-aware [lint-staged](https://github.com/lint-staged/lint-staged) config factory. Designed for monorepos where a NestJS API and an Angular SPA live in sibling folders at the repo root.

## Install

```sh
pnpm add -D @coding-with-hassan/lint-staged-config lint-staged
```

## Use

Create `lint-staged.config.js` at the repo root:

```js
module.exports = require('@coding-with-hassan/lint-staged-config')({
  api: 'de-autozaak-car-rental',
  spa: 'de-autozaak-car-rental-spa',
});
```

Both keys are optional — omit one if your repo only has the other side.

## What it does

For the **API** folder:
- `*.ts` → run ESLint with `--fix --cache`, scoped to that project (`pnpm -C <dir>`)

For the **SPA** folder:
- `*.ts`, `*.html` → run Prettier `--write` then ESLint `--fix --cache`, scoped to that project
- `*.scss`, `*.css`, `*.json` → run Prettier `--write`, scoped to that project

Per-project scoping means each side uses its own ESLint/Prettier config, so backend conventions don't leak into the frontend or vice versa.
