// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared ESLint flat config for NestJS / Node TypeScript projects.
 *
 * Usage in a consumer's eslint.config.mjs:
 *
 *   import config from '@coding-with-hassan/eslint-config-api';
 *   export default config({ tsconfigRootDir: import.meta.dirname });
 *
 * @param {{ tsconfigRootDir: string, extra?: import('typescript-eslint').ConfigArray }} opts
 */
export default function defineApiConfig({ tsconfigRootDir, extra = [] }) {
  return tseslint.config(
    { ignores: ['eslint.config.mjs', 'eslint.config.js', 'dist/**'] },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    eslintPluginPrettierRecommended,
    {
      languageOptions: {
        globals: { ...globals.node, ...globals.jest },
        sourceType: 'commonjs',
        parserOptions: { projectService: true, tsconfigRootDir },
      },
    },
    {
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-floating-promises': 'warn',
        '@typescript-eslint/no-unsafe-argument': 'warn',
        'prettier/prettier': ['error', { endOfLine: 'auto' }],
      },
    },
    ...extra,
  );
}
