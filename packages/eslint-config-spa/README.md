# @coding-with-hassan/eslint-config-spa

Shared ESLint flat config for Angular projects.

## Install

```sh
pnpm add -D @coding-with-hassan/eslint-config-spa eslint typescript
```

## Use

Create `eslint.config.js` in your Angular project root:

```js
module.exports = require('@coding-with-hassan/eslint-config-spa')({ prefix: 'app' });
```

The `prefix` is the selector prefix used for both component (`<app-foo>`) and directive (`appFoo`) selector rules. Each client typically picks its own — e.g. `bridal`, `autozaak`, `lpx`.

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
