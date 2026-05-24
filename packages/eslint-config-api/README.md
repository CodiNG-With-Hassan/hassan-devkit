# @coding-with-hassan/eslint-config-api

Shared ESLint flat config for NestJS / Node TypeScript projects.

## Install

```sh
pnpm add -D @coding-with-hassan/eslint-config-api eslint typescript
```

## Use

Create `eslint.config.mjs` in your project root:

```js
import config from '@coding-with-hassan/eslint-config-api';

export default config({
  tsconfigRootDir: import.meta.dirname,
});
```

Need a project-specific override? Pass an `extra` array of additional flat-config entries — they are appended after the base config:

```js
import config from '@coding-with-hassan/eslint-config-api';

export default config({
  tsconfigRootDir: import.meta.dirname,
  extra: [
    {
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
      },
    },
  ],
});
```

## What's in it

- `@eslint/js` recommended
- `typescript-eslint` recommended (type-checked)
- `eslint-plugin-prettier` (errors on prettier violations, with `endOfLine: 'auto'`)
- Node + Jest globals
- Sensible relaxations for NestJS: `no-explicit-any` off; `no-floating-promises` and `no-unsafe-argument` at `warn`
