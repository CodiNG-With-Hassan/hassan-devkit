# @hassan/prettier-config-api

Shared Prettier config for NestJS / Node TypeScript projects.

## Install

```sh
pnpm add -D @hassan/prettier-config-api prettier
```

## Use

In your project's `package.json`:

```json
{
  "prettier": "@hassan/prettier-config-api"
}
```

Or in a `.prettierrc` file (one line):

```json
"@hassan/prettier-config-api"
```

## What's in it

```json
{
  "singleQuote": true,
  "trailingComma": "all"
}
```

Intentionally minimal — Prettier defaults handle the rest.
