# @hassan/prettier-config-spa

Shared Prettier config for Angular projects.

## Install

```sh
pnpm add -D @hassan/prettier-config-spa prettier
```

## Use

In your project's `package.json`:

```json
{
  "prettier": "@hassan/prettier-config-spa"
}
```

Or in a `.prettierrc` file (one line):

```json
"@hassan/prettier-config-spa"
```

## What's in it

- `printWidth: 100` — wider than Prettier's default so Angular templates have room
- `singleQuote: true`
- `*.html` files use the Angular parser
- No `trailingComma` override (uses Prettier's default `all`)
