// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const prettier = require('eslint-config-prettier/flat');

/**
 * Shared ESLint flat config for Angular projects.
 *
 * Usage in a consumer's eslint.config.js:
 *
 *   module.exports = require('@coding-with-hassan/eslint-config-spa')({
 *     prefix: 'app',
 *     tsconfigRootDir: __dirname,
 *   });
 *
 * `tsconfigRootDir` anchors typescript-eslint to the consuming project.
 * Since typescript-eslint 8.5x it is effectively required: without it the
 * parser infers the root from the process cwd and errors when several
 * candidates exist — e.g. editors running the ESLint server from a monorepo
 * root ("multiple candidate TSConfigRootDirs are present").
 *
 * @param {{ tsconfigRootDir: string, prefix?: string, extra?: any[] }} opts
 */
module.exports = function defineSpaConfig(opts = {}) {
  const prefix = opts.prefix ?? 'app';
  const extra = opts.extra ?? [];
  const tsconfigRootDir = opts.tsconfigRootDir;

  return defineConfig([
    {
      files: ['**/*.ts'],
      extends: [
        eslint.configs.recommended,
        tseslint.configs.recommended,
        tseslint.configs.stylistic,
        angular.configs.tsRecommended,
      ],
      languageOptions: {
        parserOptions: { tsconfigRootDir },
      },
      processor: angular.processInlineTemplates,
      rules: {
        '@angular-eslint/directive-selector': [
          'error',
          { type: 'attribute', prefix, style: 'camelCase' },
        ],
        '@angular-eslint/component-selector': [
          'error',
          { type: 'element', prefix, style: 'kebab-case' },
        ],
      },
    },
    {
      files: ['**/*.html'],
      extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
      rules: {},
    },
    prettier,
    ...extra,
  ]);
};
