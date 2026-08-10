# @coding-with-hassan/eslint-config-spa

Shared ESLint flat config for Angular projects.

## Install

```sh
pnpm add -D @coding-with-hassan/eslint-config-spa eslint typescript
```

## Use

Create `eslint.config.js` in your Angular project root:

```js
module.exports = require('@coding-with-hassan/eslint-config-spa')({
  prefix: 'app',
  tsconfigRootDir: __dirname,
});
```

The `prefix` is the selector prefix used for both component (`<app-foo>`) and directive (`appFoo`) selector rules. Each client typically picks its own — e.g. `bridal`, `autozaak`, `lpx`.

`tsconfigRootDir` anchors typescript-eslint to the project the config belongs to. Since typescript-eslint 8.5x it is effectively required: without it the parser infers the root from the process cwd and fails in monorepos when several candidates exist (editors run the ESLint server from the monorepo root, producing `multiple candidate TSConfigRootDirs are present` on every file).

For project-specific extras (a custom rule, a folder-specific override), pass an `extra` array of additional flat-config entries:

```js
module.exports = require('@coding-with-hassan/eslint-config-spa')({
  prefix: 'autozaak',
  extra: [
    {
      files: ['**/*.spec.ts'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
  ],
});
```

## What's in it

- `@eslint/js` recommended
- `typescript-eslint` recommended + stylistic
- `angular-eslint` ts-recommended for `.ts`
- `angular-eslint` template-recommended + template-accessibility for `.html`
- `eslint-config-prettier` to disable rules that conflict with Prettier
- Customisable selector prefix for components and directives
