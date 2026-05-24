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
 *   module.exports = require('@hassan/eslint-config-spa')({ prefix: 'app' });
 *
 * @param {{ prefix?: string, extra?: any[] }} [opts]
 */
module.exports = function defineSpaConfig(opts = {}) {
  const prefix = opts.prefix ?? 'app';
  const extra = opts.extra ?? [];

  return defineConfig([
    {
      files: ['**/*.ts'],
      extends: [
        eslint.configs.recommended,
        tseslint.configs.recommended,
        tseslint.configs.stylistic,
        angular.configs.tsRecommended,
      ],
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
